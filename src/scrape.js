import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
//
import { ArgumentParser } from 'argparse';
import check from 'check-types';
import puppeteer from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
//
import * as setting from './setting.js';
import { sleep, waitForUserLogin } from './utils.js';

const main = async () => {
  //
  // get parameter
  //
  const parser = new ArgumentParser({
    description: 'XHS Scrapper',
  });
  parser.add_argument('--url', '-u', { help: 'feed url for fetching, "N" as user\'s note(笔记), "C" as user\'s (收藏), "L" as user\'s liked(点赞)' });
  parser.add_argument('--setting', '-s', { help: 'setting for fetching, absolute path OR relative path based on "--wkdir"', default: './setting.xhs-tool.json' });
  parser.add_argument('--wkdir', '-w', { help: 'working directory', required: true });
  const argv = parser.parse_args();
  // setting
  let allConfig = null;
  try {
    const w = path.resolve(argv.wkdir);
    const s = path.isAbsolute(argv.setting) ? argv.setting : path.resolve(w, argv.setting);
    //
    setting.post(JSON.parse(fs.readFileSync(s, { encoding: 'utf-8' })));
    allConfig = setting.get();
    allConfig.runtime = { wkdir: w, setting: s };
    //
    const d = allConfig?.puppeteerBrowserOption?.userDataDir || '';
    if (check.not.emptyString(d)) {
      allConfig.runtime.chromeData = path.isAbsolute(d) ? d : path.resolve(w, d);
    }
    const u = argv.url || '';
    if (check.not.emptyString(u)) {
      allConfig.runtime.feedUrl = u;
    }
  } catch (error) {
    console.log(`invalid parameter | --setting="${argv.setting}" --wkdir="${argv.wkdir}" | ${error.message}`);
    return 1;
  }
  // default value
  const browserOption = allConfig.puppeteerBrowserOption ? { ...allConfig.puppeteerBrowserOption } : {};
  if (allConfig.runtime.chromeData) {
    browserOption.userDataDir = allConfig.runtime.chromeData;
  }
  const scrapeOption = {
    maxFetchIntervalMs: 5000,
    maxNoteCount: -1,
    scrollPixel: 120,
    scrollPixelOffset: 16,
    scrollIntervalMs: 100,
    scrollIntervalMsOffset: 16,
    skipHumanVerification: false,
    ...allConfig.scrape,
  };
  if (allConfig.runtime.feedUrl) {
    scrapeOption.feedUrl = allConfig.runtime.feedUrl;
  }
  if (!scrapeOption.feedUrl) {
    console.log('main | feed url not found | check parameter [--url] OR setting [.scrape.feedUrl]');
    process.exit(1);
  }
  //
  // go to main page
  //
  puppeteer.use(Stealth());
  const browser = await puppeteer.launch(browserOption);
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.goto('https://xiaohongshu.com/', { waitUntil: 'networkidle2', timeout: 10000 });
  //
  // login and save cookie
  //
  const { userId, cookieParam, cookieHeader } = await waitForUserLogin({ page, pollingTimeMs: 10000 });
  fs.writeFileSync(path.resolve(allConfig.runtime.wkdir, 'cookie.xhs.json'), JSON.stringify(cookieParam, null, 2), { encoding: 'utf-8' });
  fs.writeFileSync(path.resolve(allConfig.runtime.wkdir, 'cookie.xhs.header.txt'), cookieHeader, { encoding: 'utf-8' });
  //
  // feed page url and output file
  //
  if (scrapeOption.feedUrl === 'N') {
    scrapeOption.feedUrl = `https://www.xiaohongshu.com/user/profile/${userId}?tab=note`;
  } else if (scrapeOption.feedUrl === 'C') {
    scrapeOption.feedUrl = `https://www.xiaohongshu.com/user/profile/${userId}?tab=fav`;
  } else if (scrapeOption.feedUrl === 'L') {
    scrapeOption.feedUrl = `https://www.xiaohongshu.com/user/profile/${userId}?tab=liked`;
  }
  //
  let outputFileName = `data.${Date.now()}`;
  let temp;
  // eslint-disable-next-line no-cond-assign
  if (temp = /xiaohongshu.com\/user\/profile\/(.*)\?tab=(.*)$/.exec(scrapeOption.feedUrl)) {
    outputFileName = `data.${temp[1]}.${temp[2] ? temp[2] : 'note'}`;
  }
  // eslint-disable-next-line no-cond-assign
  else if (temp = /xiaohongshu.com\/explore(\?channel_id=(.*))?/.exec(scrapeOption.feedUrl)) {
    outputFileName = `data.${userId}.explore.${temp[2] ? temp[2] : 'recommend'}`;
  }
  //
  // prepare note url collection
  //
  const noteUrlMap = {};
  let noteUrlMapLength = 0;
  let responseTimer = null;
  const finishCallback = () => {
    //
    // [END] stop scroll and close browser
    //
    page.evaluate(() => {
      window._scrollTimer && clearTimeout(window._scrollTimer);
    }).then(() => {
      page.off('response');
      console.log(`main | [${noteUrlMapLength}] note(s) scraped`);
      //
      const keyList = Object.keys(noteUrlMap);
      const noteUrlMapRev = {};
      for (let i = keyList.length - 1; i >= 0; i--) {
        noteUrlMapRev[keyList[i]]=noteUrlMap[keyList[i]];
      }
      //
      const json = `${allConfig.runtime.wkdir}${path.sep}${outputFileName}.json`;
      fs.writeFileSync(json, JSON.stringify(noteUrlMapRev, null, 2), { encoding: 'utf-8' });
      console.log(`main | data locates at [${json}]`);
      const txt = `${allConfig.runtime.wkdir}${path.sep}${outputFileName}.txt`;
      fs.writeFileSync(txt, Object.values(noteUrlMapRev).join('\n'), { encoding: 'utf-8' });
      console.log(`main | data locates at [${txt}]`);
      //
      console.log('main | done');
      return browser.close();
    }).then(() => process.exit(0));
  };
  page.on('response', async (response) => {
    // [SCROLL] handle page event 'response'
    //
    // filter response of api request
    //
    // note (笔记):        https://edith.xiaohongshu.com/api/sns/web/v1/user_posted
    // collection (收藏):  https://edith.xiaohongshu.com/api/sns/web/v2/note/collect/page
    // liked (点赞):       https://edith.xiaohongshu.com/api/sns/web/v1/note/like/page
    // explorer (首页):    https://edith.xiaohongshu.com/api/sns/web/v1/homefeed
    if (![ 'GET', 'POST' ].includes(response.request().method().toUpperCase()) || !/^https:\/\/edith.xiaohongshu.com\/(.*)\/(user_posted|note\/(collect|like)\/page|homefeed)/.test(response.url()) || !response.ok()) {
      return;
    }
    //
    // collect url
    //
    const responseBody = await response.json();
    if (check.array(responseBody?.data?.notes)) {
      // note, collection, liked
      responseBody.data.notes.map((n) => {
        noteUrlMap[n.note_id] = `https://www.xiaohongshu.com/explore/${n.note_id}?xsec_token=${n.xsec_token}`;
      });
      noteUrlMapLength = Object.keys(noteUrlMap).length;
    } else if (check.array(responseBody?.data?.items)) {
      // explore
      responseBody.data.items.map((n) => {
        noteUrlMap[n.id] = `https://www.xiaohongshu.com/explore/${n.id}?xsec_token=${n.xsec_token}`;
      });
      noteUrlMapLength = Object.keys(noteUrlMap).length;
    } else {
      console.log(`main | fail to handle url [${response.url()}] with response ${JSON.stringify(responseBody)}`);
      finishCallback();
      return;
    }
    process.stdout.write(`main | [${noteUrlMapLength}] note(s) scraped\r`);
    // next
    clearTimeout(responseTimer);
    scrapeOption.maxNoteCount > 0 && noteUrlMapLength >= scrapeOption.maxNoteCount && finishCallback();
    responseTimer = setTimeout(finishCallback, scrapeOption.maxFetchIntervalMs);
  });
  //
  // go to feed page
  //
  await page.goto(scrapeOption.feedUrl, { waitUntil: 'networkidle2', timeout: 10000 });
  console.log(`main | page [${scrapeOption.feedUrl}] loaded for user [${userId}]`);
  //
  // collect url on current screen
  //
  let elementHandlerList;
  while ((elementHandlerList = await page.$$('div.feeds-container:has(section.note-item) a.cover.ld.mask')).length <= 0) {
    if (scrapeOption.skipHumanVerification) {
      console.log('main | operation blocked by human verification');
      break;
    }
    process.stdout.write('main | please pass human verification | polling after 10 second(s)\r');
    await sleep(10000);
  }
  await Promise.all(elementHandlerList.map((elementHandler) => page.evaluate(el => el.href, elementHandler))).then((urlList) => urlList.map((url) => {
    let temp = /https:\/\/www.xiaohongshu.com\/user\/profile\/(.*)\/(.*)\?xsec_token=([^&]+)/.exec(url);
    temp && (noteUrlMap[temp[2]] = `https://www.xiaohongshu.com/explore/${temp[2]}?xsec_token=${temp[3]}`);
    temp = /https:\/\/www.xiaohongshu.com\/explore\/(.*)\?xsec_token=([^&]+)/.exec(url);
    temp && (noteUrlMap[temp[1]] = `https://www.xiaohongshu.com/explore/${temp[1]}?xsec_token=${temp[2]}`);
    noteUrlMapLength = Object.keys(noteUrlMap).length;
  }),
  );
  noteUrlMapLength > 0 && process.stdout.write(`main | [${noteUrlMapLength}] note(s) scraped\r`);
  //
  // [BEGIN] start scroll on feed page
  //
  responseTimer = setTimeout(finishCallback, scrapeOption.maxFetchIntervalMs);
  page.evaluate(async (_scrapeOption) => {
    // [SCROLL] trigger page event 'response'
    window._random = (center, offset) => {
      return Math.floor(Math.random() * (2 * offset + 1)) + (center - offset);
    };
    window._scrollTimer = null;
    const _scroll = () => {
      window.scrollBy(0, window._random(_scrapeOption.scrollPixel, _scrapeOption.scrollPixelOffset));
      window._scrollTimer && clearTimeout(window._scrollTimer);
      window._scrollTimer = setTimeout(_scroll, window._random(_scrapeOption.scrollIntervalMs, _scrapeOption.scrollIntervalMsOffset));
    };
    window._scrollTimer = setTimeout(_scroll, window._random(_scrapeOption.scrollIntervalMs, _scrapeOption.scrollIntervalMsOffset));
  }, scrapeOption);
};

main();

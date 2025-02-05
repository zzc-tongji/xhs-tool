import * as fs from 'node:fs';
import * as path from 'node:path';
//
import { ArgumentParser } from 'argparse';
import check from 'check-types';
import puppeteer from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
//
import * as setting from './setting.js';
import { random, sleep, waitForUserLogin } from './utils.js';

const main = async () => {
  //
  // get parameter
  //
  const parser = new ArgumentParser({
    description: 'XHS Interactor',
  });
  parser.add_argument('--like', { help: '"1" as like note, "-1" as non-like note, "0" as no operation' });
  parser.add_argument('--collect', { help: '"1" as collect note, "-1" as non-collect note, "0" as no operation' });
  parser.add_argument('--list', '-l', { help: 'url list for , splitted by linebreak, absolute path OR relative path based on "--wkdir"', default: './list.interact.txt' });
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
    allConfig.runtime = {
      wkdir: w,
      setting: s,
      collect: isNaN(argv.collect) ? (isNaN(allConfig?.interact?.collect) ? 0 : Math.sign(parseInt(allConfig.interact.collect))) : Math.sign(parseInt(argv.collect)),
      like: isNaN(argv.like) ? (isNaN(allConfig?.interact?.like) ? 0 : Math.sign(parseInt(allConfig.interact.like))) : Math.sign(parseInt(argv.like)),
    };
    const d = allConfig?.puppeteerBrowserOption?.userDataDir || '';
    if (check.not.emptyString(d)) {
      allConfig.runtime.chromeData = path.isAbsolute(d) ? d : path.resolve(w, d);
    }
    //
    allConfig.runtime.listPath = path.isAbsolute(argv.list) ? argv.list : path.resolve(allConfig.runtime.wkdir, argv.list);
    allConfig.runtime.list = fs.readFileSync(allConfig.runtime.listPath, { encoding: 'utf-8' }).split('\n').filter(s => s);
  } catch (error) {
    console.log(`invalid parameter | --setting="${argv.setting}" --wkdir="${argv.wkdir}" | ${error.message}`);
    return 1;
  }
  // default value
  const browserOption = allConfig.puppeteerBrowserOption ? { ...allConfig.puppeteerBrowserOption } : {};
  if (allConfig.runtime.chromeData) {
    browserOption.userDataDir = allConfig.runtime.chromeData;
  }
  const interactOption = {
    loadTimeMs: 3000,
    loadTimeMsOffset: 300,
    likeTimeMs: 5000,
    likeTimeMsOffset: 500,
    collectTimeMs: 5000,
    collectTimeMsOffset: 500,
    ...allConfig.interact,
    collect: allConfig.runtime.collect,
    like: allConfig.runtime.like,
    list: allConfig.runtime.list,
  };
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
  const { cookieParam, cookieHeader } = await waitForUserLogin({ page, pollingTimeMs: 10000 });
  fs.writeFileSync(path.resolve(allConfig.runtime.wkdir, 'cookie.xhs.json'), JSON.stringify(cookieParam, null, 2), { encoding: 'utf-8' });
  fs.writeFileSync(path.resolve(allConfig.runtime.wkdir, 'cookie.xhs.header.txt'), cookieHeader, { encoding: 'utf-8' });
  //
  for (let i = 0; i < interactOption.list.length; i++) {
    const url = interactOption.list[i];
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
    await sleep(random(interactOption.loadTimeMs, interactOption.loadTimeMsOffset));
    // like
    const lh = await page.$eval('div.engage-bar svg.like-icon use', (element) => {
      return element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    });
    const l = (interactOption.like * (lh === '#liked' ? 1 : -1) < 0);
    if (l) {
      await page.click('div.engage-bar svg.like-icon');
      await sleep(random(interactOption.likeTimeMs, interactOption.likeTimeMsOffset));
      console.log(`main | ${interactOption.like ? '❤️ ' : '🤍'} [${i + 1}/${interactOption.list.length}] ${url} | ${interactOption.like ? 'LIKE' : 'DIS-LIKE'}`);
    }
    // collect
    const ch = await page.$eval('div.engage-bar svg.collect-icon use', (element) => {
      return element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    });
    const c = (interactOption.collect * (ch === '#collected' ? 1 : -1) < 0);
    if (c) {
      await page.click('div.engage-bar svg.collect-icon');
      await sleep(random(interactOption.collectTimeMs, interactOption.collectTimeMsOffset));
      console.log(`main | ${interactOption.collect ? '⭐' : '🔲'} [${i + 1}/${interactOption.list.length}] ${url} | ${interactOption.collect ? 'COLLECT' : 'DIS-COLLECT'}`);
    }
    //
    if (!l && !c) {
      console.log(`main | ☑️  [${i + 1}/${interactOption.list.length}] ${url} | SKIP`);
    }
  }
  console.log('main | done');
  await browser.close();
};

main().then(() => {
  process.exit(0);
}).catch((err) => {
  throw err;
});

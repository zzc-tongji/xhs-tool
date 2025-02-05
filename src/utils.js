import * as process from 'node:process';
//
import check from 'check-types';

const random = (center, offset) => {
  return Math.floor(Math.random() * (2 * offset + 1)) + (center - offset);
};

const sleep = (ms) => {
  if (!check.number(ms) || ms <= 0) {
    throw new Error('sleep | invalid parameter');
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const waitForUserLogin = async ({ page, pollingTimeMs }) => {
  if (!page || !check.object(page)) {
    throw new Error('waitForUserLogin | parameter `page` required');
  }
  if (!check.number(pollingTimeMs) || pollingTimeMs < 10000) {
    pollingTimeMs = 10000;
  }
  let user = null;
  while (!(user = await page.$('li.user.side-bar-component'))) {
    process.stdout.write(`waitForUserLogin | non-login | please login at browser window | polling after [${pollingTimeMs / 1000}] second(s)\r`);
    await sleep(pollingTimeMs);
  }
  let temp = await user.$eval('a', (el) => el.getAttribute('href'));
  const userId = /^\/user\/profile\/(.*)$/.exec(temp)[1];
  console.log(`waitForUserLogin | login as user [${userId}]`);
  const cookieParam = (await page.cookies()).filter((c) => c.domain.endsWith('xiaohongshu.com'));
  return { userId, cookieParam, cookieHeader: cookieParam.map((c) => `${c.name}=${c.value}`).join('; ') };
};

export { random, sleep, waitForUserLogin };

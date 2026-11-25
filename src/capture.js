// Drives the browser: opens the app as the spec says, runs the steps, and returns a screenshot
// (PNG) and, for an animation, frames at a steady rate. Encoding happens elsewhere.

import { chromium } from 'playwright';
import { installNetwork } from './network.js';
import { resample } from './resample.js';

// WebGL maps need a GPU-backed context. On Windows, Direct3D 11 through ANGLE, with SwiftShader
// allowed as the fallback; elsewhere software WebGL. (Same flags as Livability-Atlas's e2e tests.)
const LAUNCH_ARGS = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-unsafe-swiftshader']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

function contextOptions(settings) {
  const options = { viewport: settings.viewport, deviceScaleFactor: settings.deviceScaleFactor };
  if (settings.colorScheme) options.colorScheme = settings.colorScheme;
  if (settings.timezoneId) options.timezoneId = settings.timezoneId;
  if (settings.locale) options.locale = settings.locale;
  if (settings.reducedMotion) options.reducedMotion = settings.reducedMotion;
  return options;
}

async function openPage(browser, spec, settings) {
  const context = await browser.newContext(contextOptions(settings));
  context.setDefaultTimeout(spec.timeoutMs);
  const network = await installNetwork(context, spec.network);
  const page = await context.newPage();
  if (settings.clock) await page.clock.setFixedTime(new Date(settings.clock));
  await page.goto(spec.url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  if (spec.hide.length > 0) {
    await page.addStyleTag({ content: `${spec.hide.join(', ')} { visibility: hidden !important; }` });
  }
  return { context, page, network };
}

// Records what the page paints, through the Chrome DevTools Protocol screencast, from
// recordStart to recordStop. The first frame is a screenshot, so a still page has a frame at once.
function makeRecorder(context, page) {
  let cdp = null;
  let frames = [];
  let fps = null;
  let start = null;
  let end = null;
  return {
    async start(rate) {
      fps = rate;
      frames = [{ ts: Date.now(), data: await page.screenshot({ type: 'png' }) }];
      cdp = await context.newCDPSession(page);
      cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
        frames.push({ ts: Date.now(), data: Buffer.from(data, 'base64') });
        try {
          await cdp.send('Page.screencastFrameAck', { sessionId });
        } catch {
          // the session closed while a frame was in flight
        }
      });
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      // The recording starts once the screencast runs, so setup time is not recording time.
      start = Date.now();
    },
    async stop() {
      end = Date.now();
      await cdp.send('Page.stopScreencast');
      await cdp.detach();
    },
    result() {
      if (start === null || end === null) throw new Error('anim.steps never reached both recordStart and recordStop');
      return { frames: resample(frames, { fps, start, end }), fps };
    },
  };
}

async function runSteps(page, steps, recorder, where) {
  for (const [i, step] of steps.entries()) {
    const [name, value] = Object.entries(step)[0];
    try {
      switch (name) {
        case 'goto': await page.goto(value, { waitUntil: 'load' }); break;
        case 'waitFor': await page.locator(value).first().waitFor({ state: 'attached' }); break;
        case 'waitForFunction': await page.waitForFunction(value); break;
        case 'waitForLoadState': await page.waitForLoadState(value); break;
        case 'click': await page.locator(value).first().click(); break;
        case 'hover': await page.locator(value).first().hover(); break;
        case 'fill': await page.locator(value[0]).first().fill(value[1]); break;
        case 'select': await page.locator(value[0]).first().selectOption(value[1]); break;
        case 'press': await page.keyboard.press(value); break;
        case 'wait': await page.waitForTimeout(value); break;
        case 'eval': await page.evaluate(value); break;
        case 'mouse': await page.mouse.move(value[0], value[1]); break;
        case 'recordStart': await recorder.start(value.fps); break;
        case 'recordStop': await recorder.stop(); break;
        default: throw new Error(`unknown step "${name}"`);
      }
    } catch (err) {
      throw new Error(`${where}[${i}] (${name}): ${err.message.split('\n')[0]}`);
    }
  }
}

function checkStopped(spec, network) {
  if (!spec.network.failOnBlocked || network.stopped.length === 0) return;
  const list = network.stopped.map((s) => `- ${s.url} (${s.reason})`).join('\n');
  throw new Error(`the network rules stopped ${network.stopped.length} request(s):\n${list}\n`
    + 'Give each one a fixture, or allow it if it carries no private data.');
}

async function captureStill(browser, spec) {
  const { context, page, network } = await openPage(browser, spec, spec);
  try {
    await runSteps(page, spec.steps, null, 'steps');
    const png = await page.screenshot({ type: 'png', caret: 'hide' });
    checkStopped(spec, network);
    return { png, network };
  } finally {
    await context.close();
  }
}

async function captureMotion(browser, spec) {
  const settings = {
    viewport: spec.anim.viewport ?? spec.viewport,
    deviceScaleFactor: spec.anim.deviceScaleFactor ?? spec.deviceScaleFactor,
    colorScheme: spec.anim.colorScheme ?? spec.colorScheme,
    timezoneId: spec.timezoneId,
    locale: spec.locale,
    reducedMotion: spec.anim.reducedMotion ?? spec.reducedMotion,
    clock: spec.anim.clock ?? spec.clock,
  };
  const { context, page, network } = await openPage(browser, spec, settings);
  try {
    const recorder = makeRecorder(context, page);
    await runSteps(page, spec.anim.steps, recorder, 'anim.steps');
    checkStopped(spec, network);
    return { ...recorder.result(), network };
  } finally {
    await context.close();
  }
}

export async function captureAll(spec, { headed = false, staticOnly = false, animOnly = false } = {}) {
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 250 : 0, args: LAUNCH_ARGS });
  const result = { png: null, frames: null, fps: null, network: { served: [], stopped: [] } };
  const merge = (network) => {
    result.network.served.push(...network.served);
    result.network.stopped.push(...network.stopped);
  };
  try {
    if (!animOnly) {
      const still = await captureStill(browser, spec);
      result.png = still.png;
      merge(still.network);
    }
    if (!staticOnly && spec.anim) {
      const motion = await captureMotion(browser, spec);
      result.frames = motion.frames;
      result.fps = motion.fps;
      merge(motion.network);
    }
    return result;
  } finally {
    await browser.close();
  }
}

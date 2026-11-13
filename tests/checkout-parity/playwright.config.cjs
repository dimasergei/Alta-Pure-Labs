'use strict';
const {defineConfig,devices}=require('@playwright/test');
const PORT=Number(process.env.CHECKOUT_PARITY_PORT||43183);
module.exports=defineConfig({
 testDir:__dirname,
 testMatch:'visual.spec.cjs',
 fullyParallel:false,
 forbidOnly:!!process.env.CI,
 retries:0,
 workers:1,
 timeout:45_000,
 reporter:[['list'],['html',{open:'never',outputFolder:'test-results/checkout-parity-report'}]],
 use:{
  baseURL:'http://127.0.0.1:'+PORT,
  viewport:{width:1536,height:900},
  deviceScaleFactor:1,
  timezoneId:'America/New_York',
  locale:'en-US',
  colorScheme:'light',
  reducedMotion:'reduce',
  screenshot:'only-on-failure',
  trace:'retain-on-failure'
 },
 projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1536,height:900},deviceScaleFactor:1}}],
 webServer:{
  command:'node tests/checkout-parity/serve.cjs',
  url:'http://127.0.0.1:'+PORT+'/tests/checkout-parity/fixture.html?view=shipping',
  reuseExistingServer:!process.env.CI,
  timeout:30_000
 },
 outputDir:'test-results/checkout-parity'
});

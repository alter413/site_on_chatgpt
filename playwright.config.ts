import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests-e2e', fullyParallel:false, workers:1, timeout:45000,
  use:{baseURL:'http://127.0.0.1:5173',browserName:'chromium',trace:'retain-on-failure'},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:false},
});

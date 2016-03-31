'use strict';
const varnishGenerator = require('../..');
const server = require('./server');
const fs = require('fs');
const path = require('path');
let varnishdInstance;

process.on('beforeExit', () => {
  if (varnishdInstance) {
    server.close();
    varnishdInstance.kill();
  }
});

varnishGenerator.getVcl({
  "stale": "3s",
  "keep": "5s",
  "grace": "5m",
  "backends": [
    {
      "name": "timtam",
      "prefix": "/timtam",
      "ip": "127.0.0.1",
      "port": 3000
    }
  ],
  "name": "varnish-test",
  "version": "2016-01-27",
  "updatedAt": ["2016-01-27"]
}).then(vcl => {
  const file = path.join(__dirname, './test.vcl');
  fs.writeFileSync(file, vcl);
  return file;
}).then(file => {
  const spawn = require('child_process').spawn;
  const args = [
    '-f',
    file,
    '-s',
    'malloc,128m',
    '-a',
    '0.0.0.0:8112',
    '-F'
  ];
  varnishdInstance = spawn('varnishd', args);
  varnishdInstance.stdout.on('data', (data) => {
    console.info(`stdout:${data}`);
  });
  varnishdInstance.stderr.on('data', (data) => {
    console.error(`stderr:${data}`);
  });
}).catch(err => console.error(err));



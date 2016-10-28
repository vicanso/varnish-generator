const generator = require('..');
const config = require('./config');

generator.getVcl(config)
  .then(console.info)
  .catch(console.error);
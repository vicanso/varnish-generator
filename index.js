const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const os = require('os');

const defaultTimeout = {
  connect: 2,
  firstByte: 5,
  betweenBytes: 2,
};

/**
 * [readFilePromise description]
 * @param  {[type]} file [description]
 * @return {[type]}      [description]
 */
function readFilePromise(file) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, 'utf8', (err, data) => {
      /* istanbul ignore if */
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/* istanbul ignore next */
function writeFilePromise(file, data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(file, data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}


function sort(items) {
  const arr = _.map(items, (item) => {
    const tmp = _.extend({}, item);
    let sortWeight = 0;
    if (!item.service) {
      sortWeight += 8;
    }
    if (!item.host) {
      sortWeight += 4;
    }
    if (!item.prefix) {
      sortWeight += 2;
    }
    tmp.sortKey = `${_.padStart(sortWeight, 2, '0')}-${item.name}`;
    return tmp;
  });
  return _.sortBy(arr, item => item.sortKey);
}

function convertBackends(backends) {
  const result = [];
  _.forEach(backends, (backend) => {
    if (_.isString(backend.port)) {
      const port = backend.port;
      let portList = [];
      if (port.indexOf(',') !== -1) {
        portList = port.split(',');
      } else if (port.indexOf('..') !== -1) {
        const arr = port.split('..');
        portList = _.range(parseInt(arr[0], 10), parseInt(arr[1], 10));
      } else {
        portList.push(port);
      }
      _.forEach(portList, (item) => {
        result.push(_.extend({}, backend, {
          port: parseInt(item, 10),
        }));
      });
    } else {
      result.push(backend);
    }
  });
  return result;
}

function getBackendConfig(directors) {
  const sortedDirectors = sort(directors);
  return readFilePromise(path.join(__dirname,
      'template/backend.tpl'))
    .then((tpl) => {
      const template = _.template(tpl);
      const arr = [];
      _.forEach(sortedDirectors, (director) => {
        const backends = convertBackends(director.backends);
        _.forEach(backends, (backend, i) => {
          const tmp = _.extend({
            timeout: _.extend({}, defaultTimeout, director.timeout),
            ping: director.ping || '/ping',
          }, backend);
          tmp.name = `${_.camelCase(director.name)}${i}`;
          try {
            arr.push(template(tmp));
          } catch (err) {
            /* istanbul ignore next */
            console.error(err);
          }
        });
      });
      return arr.join('\n');
    });
}


function getInitConfig(directors) {
  const sortedDirectors = sort(directors);
  return readFilePromise(path.join(__dirname, 'template/init.tpl'))
    .then((tpl) => {
      const template = _.template(tpl);
      const arr = [];
      _.forEach(sortedDirectors, (director) => {
        const name = _.camelCase(director.name);
        const type = director.type || 'round_robin';
        arr.push(`new ${name} = directors.${type}();`);
        const backends = convertBackends(director.backends);
        _.forEach(backends, (server, i) => {
          if (type === 'random' || type === 'hash') {
            arr.push(`${name}.add_backend(${name + i}, ${server.weight || 1});`);
          } else {
            arr.push(`${name}.add_backend(${name + i});`);
          }
        });
      });
      _.forEach(arr, (tmp, i) => {
        arr[i] = `  ${tmp}`;
      });
      return template({
        directors: arr.join('\n'),
      });
    });
}

function getBackendSelectConfig(directors) {
  const sortedDirectors = sort(directors);
  const result = [];
  let defaultDirector;
  _.forEach(sortedDirectors, (director) => {
    const arr = [];
    /* istanbul ignore else */
    if (director.service) {
      arr.push(`req.http.X-Service == "${director.service}"`);
    }
    /* istanbul ignore else */
    if (director.host) {
      if (_.isArray(director.host)) {
        const hostEqList = _.map(director.host, item => `req.http.host == "${item}"`);
        arr.push(`(${hostEqList.join(' || ')})`);
      } else {
        arr.push(`req.http.host == "${director.host}"`);
      }
    }
    /* istanbul ignore else */
    if (director.prefix) {
      arr.push(`req.url ~ "^${director.prefix}"`);
    }
    const condition = arr.join(' && ');
    if (condition) {
      result.push({
        name: director.name,
        condition,
        type: director.type,
        hashKey: director.hashKey,
      });
    } else {
      defaultDirector = director;
    }
  });

  const getBackendHint = (director) => {
    if (director.type === 'hash') {
      const hashKey = director.hashKey || 'req.url';
      return `set req.backend_hint = ${_.camelCase(director.name)}.backend(${hashKey});`;
    }
    return `set req.backend_hint = ${_.camelCase(director.name)}.backend();`;
  };

  const arr = [];
  if (defaultDirector) {
    arr.push(getBackendHint(defaultDirector));
  }
  _.forEach(result, (item, i) => {
    if (i === 0) {
      arr.push(`if (${item.condition}) {`);
    } else {
      arr.push(`} elsif (${item.condition}) {`);
    }
    arr.push(`  ${getBackendHint(item)}`);
  });
  /* istanbul ignore else */
  if (arr.length) {
    if (arr.length > 1) {
      arr.push('}');
    }
    _.forEach(arr, (tmp, i) => {
      arr[i] = `  ${tmp}`;
    });
  }
  return arr.join('\n');
}

/**
 * [getConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getConfig(directors) {
  const data = {};
  return getBackendConfig(directors).then((config) => {
    data.backendConfig = config;
    return getInitConfig(directors);
  }).then((config) => {
    data.initConfig = config;
    data.selectConfig = getBackendSelectConfig(directors);
    return data;
  });
}

function getPassRules(urls) {
  const rules = ['req.http.Cache-Control == "no-cache"'];
  _.forEach(urls, url => rules.push(`req.url ~ "${url}"`));
  return rules.join(' || ');
}

function getHash(hashConfig) {
  const arr = [];
  _.forEach(hashConfig, (item) => {
    if (_.isString(item)) {
      arr.push(`hash_data(${item});`);
      return;
    }
    const total = item.length;
    const tmpArr = [];
    _.forEach(item, (subItem, index) => {
      const hashStr = `  hash_data(${subItem});`;
      if (index === 0) {
        tmpArr.push(`if (${subItem}) {`);
        tmpArr.push(hashStr);
      } else if (index === total - 1) {
        tmpArr.push('} else {');
        tmpArr.push(hashStr);
        tmpArr.push('}');
      } else {
        tmpArr.push(`} elsif (${subItem}) {`);
        tmpArr.push(hashStr);
      }
    });
    arr.push(...tmpArr);
  });
  return _.map(arr, item => `  ${item}`).join('\n');
}

/**
 * [getVcl description]
 * @param  {[type]} config [description]
 * @return {[type]}        [description]
 */
function getVcl(conf) {
  const config = _.extend({
    version: new Date().toISOString(),
    timeout: defaultTimeout,
    urlPassList: ['cache-control=no-cache'],
    hash: [
      'req.url',
      [
        'req.http.host',
        'server.ip',
      ],
    ],
    hisForPassTTL: 120,
  }, conf);
  /* istanbul ignore if */
  if (!config.directors || !config.name) {
    throw new Error('directors, name can not be null');
  }
  if (!config.directors.length) {
    throw new Error('directors can not be empty');
  }
  if (config.name === '$HOSTNAME') {
    config.name = os.hostname();
  } else if (config.name[0] === '$') {
    config.name = process.env[config.name.substring(1)];
  }
  _.forEach(config.directors, (item) => {
    if (!item.timeout) {
      /* eslint no-param-reassign:0 */
      item.timeout = config.timeout;
    }
    if (item.type === 'shard') {
      throw new Error('shard director is not support');
    }
  });
  const cloneConfig = _.extend({
    stale: 3,
    varnish: '5',
    hashConfig: getHash(config.hash),
    passRules: getPassRules(config.urlPassList),
  }, config);
  return getConfig(cloneConfig.directors).then((data) => {
    _.extend(cloneConfig, data);
    return readFilePromise(path.join(__dirname, 'template/varnish.tpl'));
  }).then(tpl => _.template(tpl)(cloneConfig));
}

function getVclFromFile(file) {
  const extname = path.extname(file);
  return readFilePromise(file)
    .then((data) => {
      const json = extname === '.yml' ? yaml.safeLoad(data) : JSON.parse(data);
      return getVcl(json);
    });
}

exports.getBackendConfig = getBackendConfig;
exports.getInitConfig = getInitConfig;
exports.getBackendSelectConfig = getBackendSelectConfig;
exports.getConfig = getConfig;
exports.getVcl = getVcl;
exports.getVclFromFile = getVclFromFile;
exports.writeVclToFile = writeFilePromise;

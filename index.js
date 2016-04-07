'use strict';
const _ = require('lodash');
const path = require('path');
const fs = require('fs');

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

/**
 * [sortServer description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function sortServer(serverList) {
  let result = {};
  _.forEach(serverList, server => {
    const name = server.name;
    if (!result[name]) {
      result[name] = [];
    }
    result[name].push(server);
  });
  // 将有配置host的排在前面
  result = _.values(result);
  result.sort((tmp1, tmp2) => {
    const host1 = tmp1[0].host;
    const host2 = tmp2[0].host;
    const name1 = tmp1[0].name;
    const name2 = tmp2[0].name;
    let v = 0;
    /* istanbul ignore next */
    if (host1 && !host2) {
      v = -1;
    } else if (!host1 && host2) {
      v = 1;
    } else if (name1 < name2) {
      v = 1;
    } else if (name1 > name2) {
      v = -1;
    }
    return v;
  });
  return result;
}

/**
 * [getBackendConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getBackendConfig(serverList) {
  const sortedServerList = sortServer(serverList);
  return readFilePromise(path.join(__dirname,
      'template/backend.tpl'))
    .then(tpl => {
      const template = _.template(tpl);
      const arr = [];
      _.forEach(sortedServerList, (servers) => {
        _.forEach(servers, (server, i) => {
          const tmp = _.pick(server, 'name ip port'.split(' '));
          tmp.name = _.camelCase(tmp.name);
          tmp.name += i;
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

/**
 * [getInitConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getInitConfig(serverList) {
  const sortedServerList = sortServer(serverList);
  return readFilePromise(path.join(__dirname, 'template/init.tpl'))
    .then(tpl => {
      const template = _.template(tpl);
      const arr = [];
      _.forEach(sortedServerList, (servers) => {
        const name = _.camelCase(servers[0].name);
        arr.push(`new ${name} = directors.random();`);
        _.forEach(servers, (server, i) => {
          arr.push(`${name}.add_backend(${name + i}, ${server.weight || 1});`);
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

/**
 * [getBackendSelectConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getBackendSelectConfig(serverList) {
  const sortedServerList = sortServer(serverList);
  const result = [];
  let defaultBackend;
  _.forEach(sortedServerList, (servers) => {
    const server = servers[0];
    const arr = [];
    /* istanbul ignore else */
    if (server.host) {
      arr.push(`req.http.host == "${server.host}"`);
    }
    /* istanbul ignore else */
    if (server.prefix) {
      arr.push(`req.url ~ "^${server.prefix}"`);
    }
    const condition = arr.join(' && ');
    if (condition) {
      result.push({
        name: server.name,
        condition,
      });
    } else {
      defaultBackend = server.name;
    }
  });

  const arr = [];
  if (defaultBackend) {
    arr.push(`set req.backend_hint = ${_.camelCase(defaultBackend)}.backend();`);
  }
  _.forEach(result, (item, i) => {
    if (i === 0) {
      arr.push(`if(${item.condition}){`);
    } else {
      arr.push(`}elsif(${item.condition}){`);
    }
    arr.push(`  set req.backend_hint = ${_.camelCase(item.name)}.backend();`);
  });
  /* istanbul ignore else */
  if (arr.length) {
    arr.push('}');
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
function getConfig(serverList) {
  const data = {};
  return getBackendConfig(serverList).then(config => {
    data.backendConfig = config;
    return getInitConfig(serverList);
  }).then(config => {
    data.initConfig = config;
    data.selectConfig = getBackendSelectConfig(serverList);
    return data;
  });
}

/**
 * [getVcl description]
 * @param  {[type]} config [description]
 * @return {[type]}        [description]
 */
function getVcl(config) {
  /* istanbul ignore if */
  if (!config.backends || !config.name || !config.version) {
    throw new Error('backends, name and version can not be null');
  }
  _.extend(config, {
    stale: '3s',
    keep: '10s',
    grace: '30m',
  });
  return getConfig(config.backends).then(data => {
    _.extend(config, data);
    return readFilePromise(path.join(__dirname, 'template/varnish.tpl'));
  }).then(tpl => _.template(tpl)(config));
}


exports.getBackendConfig = getBackendConfig;
exports.getInitConfig = getInitConfig;
exports.getBackendSelectConfig = getBackendSelectConfig;
exports.getConfig = getConfig;
exports.getVcl = getVcl;

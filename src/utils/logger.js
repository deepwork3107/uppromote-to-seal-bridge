function log(...args) {
  console.log(new Date().toISOString(), "-", ...args);
}

function error(...args) {
  console.error(new Date().toISOString(), "ERROR 123-", ...args);
}

module.exports = { log, error };

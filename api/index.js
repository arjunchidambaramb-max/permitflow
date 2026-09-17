/**
 * Vercel Serverless Entrypoint
 * Routes all incoming requests to the unified PermitFlow server request handler.
 */
const requestHandler = require('../server');

module.exports = (req, res) => {
  return requestHandler(req, res);
};

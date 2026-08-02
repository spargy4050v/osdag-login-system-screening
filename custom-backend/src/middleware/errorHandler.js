function notFound(req, res) {
  return res.status(404).json({ error: 'Route not found' });
}

function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };

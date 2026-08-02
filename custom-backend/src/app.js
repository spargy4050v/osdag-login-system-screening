const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const env = require('./config/env');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const authRoutes = require('./routes/authRoutes');
const fileRoutes = require('./routes/fileRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

app.disable('x-powered-by');

// A credentialed CORS response is necessary for the browser to send the JWT
// cookie from the separately served static test client.
app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.use(authRoutes);
app.use(userRoutes);
app.use(fileRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

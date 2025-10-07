import app from './app.js';
import { env } from './config/env.js';
import profileRouter from './routes/profile.js';

app.listen(env.port, () => console.log(`API on http://localhost:${env.port}`));
app.use('/api/profile', profileRouter);

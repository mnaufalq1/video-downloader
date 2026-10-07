import express, { Application } from 'express';
import cors from 'cors';
import mediaRoutes from './routes/media.routes.js';

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api/media', mediaRoutes);

app.listen(PORT, () => {
  console.log(`Server Express TypeScript berjalan di http://localhost:${PORT}`);
}); 
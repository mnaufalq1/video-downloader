import express, { Router } from 'express';
import { getMediaInfo, downloadMedia } from '../controllers/media.controller.js';

const router: Router = express.Router();

// Endpoint Metadata (POST)
router.post('/info', getMediaInfo);

// Endpoint Download Stream (GET)
router.get('/download', downloadMedia);

export default router;
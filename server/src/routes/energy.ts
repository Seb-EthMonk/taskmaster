/**
 * Energy Routes for TaskMaster
 * Provides API endpoints for server-side energy state management.
 *
 * GET  /api/energy               — get current energy state
 * POST /api/energy/settings      — update enabled, maxEnergy, threshold
 * POST /api/energy/feed          — feed energy using a feed item
 * POST /api/energy/consume       — consume energy explicitly
 * POST /api/energy/reset         — reset to defaults
 */

import { Router, Request, Response } from 'express';
import {
  getEnergyState,
  updateEnergySettings,
  feedEnergy,
  consumeEnergyDirect,
  resetEnergy,
  FEED_ITEMS,
} from '../services/energy.js';

const router = Router();

// ─── GET /api/energy ─────────────────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response) => {
  try {
    const energy = await getEnergyState();
    res.json({
      success: true,
      energy,
      feedItems: FEED_ITEMS,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Energy] Error getting energy state:', err);
    res.status(500).json({
      error: 'Failed to get energy state',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ─── POST /api/energy/settings ───────────────────────────────────────────────

router.post('/settings', async (req: Request, res: Response) => {
  try {
    const { enabled, maxEnergy, threshold } = req.body;

    // Validate inputs
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid input', message: 'enabled must be a boolean' });
    }
    if (maxEnergy !== undefined) {
      if (typeof maxEnergy !== 'number' || !Number.isInteger(maxEnergy) || maxEnergy < 10 || maxEnergy > 1000) {
        return res.status(400).json({ error: 'Invalid input', message: 'maxEnergy must be an integer between 10 and 1000' });
      }
    }
    if (threshold !== undefined) {
      if (typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 5 || threshold > 50) {
        return res.status(400).json({ error: 'Invalid input', message: 'threshold must be an integer between 5 and 50' });
      }
    }

    const energy = await updateEnergySettings({ enabled, maxEnergy, threshold });
    res.json({
      success: true,
      energy,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Energy] Error updating settings:', err);
    res.status(500).json({
      error: 'Failed to update energy settings',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ─── POST /api/energy/feed ───────────────────────────────────────────────────

router.post('/feed', async (req: Request, res: Response) => {
  try {
    const { feedItemId } = req.body;

    if (!feedItemId || typeof feedItemId !== 'string') {
      return res.status(400).json({ error: 'Invalid input', message: 'feedItemId is required' });
    }

    const validIds = FEED_ITEMS.map(f => f.id);
    if (!validIds.includes(feedItemId as any)) {
      return res.status(400).json({
        error: 'Invalid feed item',
        message: `feedItemId must be one of: ${validIds.join(', ')}`,
      });
    }

    const result = await feedEnergy(feedItemId);

    if (!result.success) {
      const statusCode = result.error === 'Already at maximum energy' ? 409 : 400;
      return res.status(statusCode).json({ error: result.error });
    }

    const energy = await getEnergyState();
    res.json({
      success: true,
      feedItem: result.feedItem,
      previousEnergy: result.previousEnergy,
      currentEnergy: result.currentEnergy,
      maxEnergy: result.maxEnergy,
      receipt: result.receipt,
      energy,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Energy] Error feeding energy:', err);
    res.status(500).json({
      error: 'Failed to feed energy',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ─── POST /api/energy/consume ────────────────────────────────────────────────

router.post('/consume', async (req: Request, res: Response) => {
  try {
    const { amount, description } = req.body;

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid input', message: 'amount must be a positive integer' });
    }
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Invalid input', message: 'description is required' });
    }

    const result = await consumeEnergyDirect(amount, description);

    if (!result.success) {
      return res.status(400).json({
        error: result.error || 'Insufficient energy',
        currentEnergy: result.currentEnergy,
        maxEnergy: result.maxEnergy,
      });
    }

    const energy = await getEnergyState();
    res.json({
      success: true,
      consumed: amount,
      currentEnergy: result.currentEnergy,
      maxEnergy: result.maxEnergy,
      receipt: result.receipt,
      energy,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Energy] Error consuming energy:', err);
    res.status(500).json({
      error: 'Failed to consume energy',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ─── POST /api/energy/reset ──────────────────────────────────────────────────

router.post('/reset', async (_req: Request, res: Response) => {
  try {
    const energy = await resetEnergy();
    res.json({
      success: true,
      energy,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Energy] Error resetting energy:', err);
    res.status(500).json({
      error: 'Failed to reset energy',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;

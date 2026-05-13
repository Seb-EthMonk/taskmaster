import { Router } from 'express';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// Data directory for port registry
const DATA_DIR = join(__dirname, '../../data');
const PORT_REGISTRY_FILE = join(DATA_DIR, 'port-registry.json');

// Types
export interface PortAllocation {
  projectId: string;
  projectName: string;
  port: number;
  allocatedAt: string;
  description?: string;
  autostart?: boolean;
  projectPath?: string;
  startCommand?: string;
}

export interface PortRegistry {
  allocations: PortAllocation[];
  lastUpdated: string;
  version: string;
}

// Default port range
const MIN_PORT = 3000;
const MAX_PORT = 65535;

// Default entries
const DEFAULT_ALLOCATIONS: PortAllocation[] = [
  {
    projectId: 'taskmaster',
    projectName: 'TaskMaster',
    port: 3000,
    allocatedAt: new Date().toISOString(),
    description: 'TaskMaster server default port'
  }
];

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  try {
    await access(DATA_DIR);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

/**
 * Load port registry from file, creating defaults if needed
 */
async function loadPortRegistry(): Promise<PortRegistry> {
  await ensureDataDir();

  try {
    const content = await readFile(PORT_REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(content);

    // Merge with defaults to ensure all fields exist
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      allocations: parsed.allocations || DEFAULT_ALLOCATIONS,
      ...parsed
    };
  } catch {
    // File doesn't exist or is invalid - create with defaults
    const registry: PortRegistry = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      allocations: [...DEFAULT_ALLOCATIONS]
    };
    await savePortRegistry(registry);
    return registry;
  }
}

/**
 * Save port registry to file
 */
async function savePortRegistry(registry: PortRegistry): Promise<void> {
  await ensureDataDir();
  registry.lastUpdated = new Date().toISOString();
  await writeFile(PORT_REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Find the next available port
 */
function findNextAvailablePort(registry: PortRegistry): number {
  const usedPorts = new Set(registry.allocations.map(a => a.port));

  // Start from MIN_PORT and find first available
  for (let port = MIN_PORT; port <= MAX_PORT; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  throw new Error('No available ports in range');
}

/**
 * Check if a port is already allocated
 */
function isPortAllocated(registry: PortRegistry, port: number): boolean {
  return registry.allocations.some(a => a.port === port);
}

/**
 * Get allocation for a specific project
 */
function getProjectAllocation(registry: PortRegistry, projectId: string): PortAllocation | undefined {
  return registry.allocations.find(a => a.projectId === projectId);
}

// GET /api/ports - List all port allocations
router.get('/', async (req, res) => {
  try {
    const registry = await loadPortRegistry();

    // Sort by port number
    const sortedAllocations = [...registry.allocations].sort((a, b) => a.port - b.port);

    res.json({
      success: true,
      allocations: sortedAllocations,
      count: sortedAllocations.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Ports] Error loading port registry:', err);
    res.status(500).json({
      error: 'Failed to load port registry',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// GET /api/ports/:projectId - Get port for specific project
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const registry = await loadPortRegistry();

    const allocation = getProjectAllocation(registry, projectId);

    if (!allocation) {
      return res.status(404).json({
        error: 'Not found',
        message: `No port allocation found for project: ${projectId}`
      });
    }

    res.json({
      success: true,
      allocation,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Ports] Error getting project port:', err);
    res.status(500).json({
      error: 'Failed to get port allocation',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// POST /api/ports - Allocate new port
router.post('/', async (req, res) => {
  try {
    const { projectId, projectName, port, description, autostart, projectPath, startCommand } = req.body;

    // Validate required fields
    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'projectId is required and must be a string'
      });
    }

    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'projectName is required and must be a string'
      });
    }

    const registry = await loadPortRegistry();

    // Check if project already has a port allocated
    const existingAllocation = getProjectAllocation(registry, projectId);
    if (existingAllocation) {
      return res.status(409).json({
        error: 'Already allocated',
        message: `Project ${projectId} already has port ${existingAllocation.port} allocated`,
        allocation: existingAllocation
      });
    }

    // Determine port to allocate
    let allocatedPort: number;

    if (port !== undefined) {
      // Specific port requested
      if (typeof port !== 'number' || port < MIN_PORT || port > MAX_PORT) {
        return res.status(400).json({
          error: 'Invalid port',
          message: `Port must be a number between ${MIN_PORT} and ${MAX_PORT}`
        });
      }

      if (isPortAllocated(registry, port)) {
        return res.status(409).json({
          error: 'Port in use',
          message: `Port ${port} is already allocated`,
          conflict: registry.allocations.find(a => a.port === port)
        });
      }

      allocatedPort = port;
    } else {
      // Auto-assign next available port
      try {
        allocatedPort = findNextAvailablePort(registry);
      } catch {
        return res.status(503).json({
          error: 'No ports available',
          message: 'No available ports in the valid range'
        });
      }
    }

    // Create new allocation
    const newAllocation: PortAllocation = {
      projectId,
      projectName: projectName.trim(),
      port: allocatedPort,
      allocatedAt: new Date().toISOString(),
      description: description?.trim(),
      autostart: autostart ?? false,
      projectPath: projectPath?.trim(),
      startCommand: startCommand?.trim()
    };

    // Add to registry
    registry.allocations.push(newAllocation);
    await savePortRegistry(registry);

    console.log(`[Ports] Allocated port ${allocatedPort} to project: ${projectId}`);

    res.status(201).json({
      success: true,
      allocation: newAllocation,
    autoAssigned: port === undefined,
    timestamp: new Date().toISOString()
  });
} catch (err) {
  console.error('[Ports] Error allocating port:', err);
  res.status(500).json({
    error: 'Failed to allocate port',
    message: err instanceof Error ? err.message : 'Unknown error'
  });
}
});

// PATCH /api/ports/:projectId - Update port allocation
router.patch('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { projectName, description, autostart, projectPath, startCommand } = req.body;
    const registry = await loadPortRegistry();

    const allocationIndex = registry.allocations.findIndex(a => a.projectId === projectId);

    if (allocationIndex === -1) {
      return res.status(404).json({
        error: 'Not found',
        message: `No port allocation found for project: ${projectId}`
      });
    }

    const allocation = registry.allocations[allocationIndex];

    // Update allowed fields
    if (projectName !== undefined) {
      allocation.projectName = projectName.trim();
    }
    if (description !== undefined) {
      allocation.description = description?.trim() || undefined;
    }
    if (autostart !== undefined) {
      allocation.autostart = Boolean(autostart);
    }
    if (projectPath !== undefined) {
      allocation.projectPath = projectPath?.trim() || undefined;
    }
    if (startCommand !== undefined) {
      allocation.startCommand = startCommand?.trim() || undefined;
    }

    await savePortRegistry(registry);

    console.log(`[Ports] Updated allocation for project: ${projectId}`);

    res.json({
      success: true,
      allocation,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Ports] Error updating allocation:', err);
    res.status(500).json({
      error: 'Failed to update allocation',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// DELETE /api/ports/:projectId - Free a port
router.delete('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const registry = await loadPortRegistry();

    const allocationIndex = registry.allocations.findIndex(a => a.projectId === projectId);

    if (allocationIndex === -1) {
      return res.status(404).json({
        error: 'Not found',
        message: `No port allocation found for project: ${projectId}`
      });
    }

    const removedAllocation = registry.allocations[allocationIndex];

    // Remove from registry
    registry.allocations.splice(allocationIndex, 1);
    await savePortRegistry(registry);

    console.log(`[Ports] Freed port ${removedAllocation.port} from project: ${projectId}`);

    res.json({
      success: true,
      freed: removedAllocation,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Ports] Error freeing port:', err);
    res.status(500).json({
      error: 'Failed to free port',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// GET /api/ports/check/:port - Check if a port is available
router.get('/check/:port', async (req, res) => {
  try {
    const portNum = parseInt(req.params.port, 10);

    if (isNaN(portNum) || portNum < MIN_PORT || portNum > MAX_PORT) {
      return res.status(400).json({
        error: 'Invalid port',
        message: `Port must be a number between ${MIN_PORT} and ${MAX_PORT}`
      });
    }

    const registry = await loadPortRegistry();
    const allocation = registry.allocations.find(a => a.port === portNum);

    res.json({
      success: true,
      port: portNum,
      available: !allocation,
      allocation: allocation || undefined,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Ports] Error checking port:', err);
    res.status(500).json({
      error: 'Failed to check port',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

export default router;

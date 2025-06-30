import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs';

//a secret key defined as an ENV variable to ensure only our own app can post data
const POOLMON_API_KEY = process.env.POOLMON_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GENERATE_DUMMY_DATA = false;

// Hardcoded sensor mappings for your specific one-wire devices
const SENSOR_LOCATIONS = {
    '28-012054745c8c': 'pool',
    '28-012054899557': 'outside'
} as const;

// Helper functions for device ID and location mapping
function getLocationFromDeviceId(deviceId: string): string | null {
    return SENSOR_LOCATIONS[deviceId as keyof typeof SENSOR_LOCATIONS] || null;
}

function getDeviceIdsForLocation(location: string): string[] {
    return Object.entries(SENSOR_LOCATIONS)
        .filter(([_, loc]) => loc === location)
        .map(([deviceId, _]) => deviceId);
}

function getAllLocations(): string[] {
    return [...new Set(Object.values(SENSOR_LOCATIONS))];
}

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database('pool_temperature.db');

// Initialize database table
db.serialize(() => {
    // Create temperature readings table with device_id support
    db.run(`
        CREATE TABLE IF NOT EXISTS temperature_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            temperature REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            device_id TEXT NOT NULL
        )
    `);

    // Create indexes for better query performance with large datasets
    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON temperature_readings(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_device_id ON temperature_readings(device_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_device_timestamp ON temperature_readings(device_id, timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp_desc ON temperature_readings(timestamp DESC)`);

    // Covering indexes that include temperature to avoid table lookups
    db.run(`CREATE INDEX IF NOT EXISTS idx_covering_stats ON temperature_readings(timestamp, device_id, temperature)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_covering_latest ON temperature_readings(device_id, timestamp DESC, temperature)`);

    // Set SQLite performance optimizations for large datasets
    db.run(`PRAGMA journal_mode = WAL`); // Write-Ahead Logging for better concurrency
    db.run(`PRAGMA synchronous = NORMAL`); // Faster than FULL, still safe
    db.run(`PRAGMA cache_size = 20000`); // Increase cache size further for better performance
    db.run(`PRAGMA temp_store = MEMORY`); // Store temporary data in memory
    db.run(`PRAGMA mmap_size = 268435456`); // Use memory-mapped I/O (256MB)
    db.run(`PRAGMA optimize`); // Run SQLite query planner optimizations

    // Run ANALYZE to update SQLite's internal statistics for better query planning
    setTimeout(() => {
        db.run(`ANALYZE`, (err) => {
            if (err) {
                console.error('Error running ANALYZE:', err);
            } else {
                console.log('Database statistics updated for optimal query planning');
            }
        });
    }, 5000); // Run after initial data load

    if (GENERATE_DUMMY_DATA) {
        // Initialize data and set up scheduled updates
        db.get("SELECT COUNT(*) as count FROM temperature_readings", async (err, row: any) => {
            if (row.count === 0) {
                console.log('No existing data found. Generating dummy temperature data for the past month...');
                const startTime = Date.now();

                // Generate 1 month of data with real device IDs
                const dummyData = generateDummyData({
                    monthsAgo: 1,
                    intervalMinutes: 1
                });

                const generationTime = Date.now() - startTime;
                console.log(`Data generation took ${(generationTime / 1000).toFixed(2)} seconds`);

                console.log('Starting database insertion...');
                const insertStartTime = Date.now();

                try {
                    await insertDataBatch(dummyData);

                    const insertionTime = Date.now() - insertStartTime;
                    const totalTime = Date.now() - startTime;

                    console.log(`Database insertion took ${(insertionTime / 1000).toFixed(2)} seconds`);
                    console.log(`Total time: ${(totalTime / 1000).toFixed(2)} seconds`);
                    console.log(`Successfully inserted ${dummyData.length.toLocaleString()} temperature readings`);
                    console.log(`Average insertion rate: ${Math.round(dummyData.length / (insertionTime / 1000)).toLocaleString()} records/second`);
                } catch (error) {
                    console.error('Error during initial data insertion:', error);
                }
            } else {
                console.log(`Database already contains ${row.count.toLocaleString()} temperature readings`);
            }
        });
    }
});

// Function to generate realistic dummy data
function generateDummyData(options: {
    monthsAgo: number;
    intervalMinutes: number;
}) {
    const { monthsAgo, intervalMinutes } = options;

    const endDate = new Date(); // Always end at current time
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsAgo);

    const intervalMs = intervalMinutes * 60 * 1000;
    const totalIntervals = Math.floor((endDate.getTime() - startDate.getTime()) / intervalMs);

    console.log(`Starting to generate temperature data...`);
    console.log(`Period: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`Interval: ${intervalMinutes} minute(s)`);
    console.log(`Will generate approximately ${totalIntervals * 2} temperature readings...`);

    const data = [];
    let recordCount = 0;

    // Generate readings at specified intervals for the specified time range
    let previousOutsideTemp = 72; // Track previous temperature for smoother transitions
    let weatherPattern = Math.random(); // Random weather pattern for the period

    for (let time = new Date(startDate); time <= endDate; time = new Date(time.getTime() + intervalMs)) {
        const timestamp = time.toISOString();
        const dayOfYear = Math.floor((time.getTime() - new Date(time.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000));

        // Generate realistic outside temperature with more variety
        const baseOutsideTemp = 72;

        // Seasonal variation (warmer in summer, colder in winter)
        const seasonalVariation = Math.sin((dayOfYear / 365) * Math.PI * 2) * 25; // Stronger seasonal effect

        // Daily cycle with more dramatic changes (coldest at 6AM, hottest at 3PM)
        const hourOfDay = time.getHours() + time.getMinutes() / 60;
        const dailyCycle = Math.sin((hourOfDay - 6) / 24 * Math.PI * 2) * 15; // Stronger daily cycle

        // Day-to-day weather variation (some days are just hotter/colder)
        const dayVariation = Math.sin((dayOfYear * 7) / 365 * Math.PI * 2) * 8; // Weekly-ish weather patterns

        // Random weather events (cold fronts, heat waves, etc.)
        weatherPattern += (Math.random() - 0.5) * 0.1; // Slowly changing weather pattern
        weatherPattern = Math.max(-1, Math.min(1, weatherPattern)); // Keep in bounds
        const weatherEffect = weatherPattern * 12; // Can add/subtract up to 12 degrees

        // Hourly noise with some persistence (temperature doesn't change too quickly)
        const hourlyNoise = (Math.random() - 0.5) * 3;

        const targetOutsideTemp = baseOutsideTemp + seasonalVariation + dailyCycle + dayVariation + weatherEffect + hourlyNoise;

        // Smooth temperature transitions (temperature can't change too rapidly)
        const maxChange = 2; // Maximum temperature change per interval
        const tempDiff = targetOutsideTemp - previousOutsideTemp;
        const actualChange = Math.max(-maxChange, Math.min(maxChange, tempDiff));
        const outsideTemp = previousOutsideTemp + actualChange;
        previousOutsideTemp = outsideTemp;

        // Generate realistic pool temperature (varies less, influenced by outside temp)
        const basePoolTemp = 80;

        // Pool responds slower to temperature changes
        const poolSeasonalVariation = seasonalVariation * 0.3; // Less seasonal effect
        const poolDailyVariation = dailyCycle * 0.2; // Less daily variation

        // Pool temperature is somewhat influenced by outside temperature
        const outsideTempInfluence = (outsideTemp - baseOutsideTemp) * 0.1;

        // Pool heating/cooling patterns (warmer during day due to sun, cooler at night)
        const poolHeatCycle = Math.sin((hourOfDay - 12) / 24 * Math.PI * 2) * 2; // Peak heating at noon

        const poolNoise = (Math.random() - 0.5) * 1.5; // Less noise for pool
        const poolTemp = basePoolTemp + poolSeasonalVariation + poolDailyVariation + outsideTempInfluence + poolHeatCycle + poolNoise;

        // Add both readings with the same timestamp
        data.push({
            temp: Math.round(poolTemp * 10) / 10, // Round to 1 decimal
            deviceId: getDeviceIdsForLocation('pool')[0],
            timestamp: timestamp
        });

        data.push({
            temp: Math.round(outsideTemp * 10) / 10, // Round to 1 decimal
            deviceId: getDeviceIdsForLocation('outside')[0],
            timestamp: timestamp
        });

        recordCount += 2;

        // Log progress every 100,000 records
        if (recordCount % 100000 === 0) {
            console.log(`Generated ${recordCount.toLocaleString()} records...`);
        }
    }

    console.log(`Finished generating ${recordCount.toLocaleString()} total temperature readings`);
    return data;
}

// Function to insert data in batches using transactions
function insertDataBatch(data: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
        if (data.length === 0) {
            resolve();
            return;
        }

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            const stmt = db.prepare("INSERT INTO temperature_readings (temperature, device_id, timestamp) VALUES (?, ?, ?)");

            data.forEach((item) => {
                stmt.run(item.temp, item.deviceId, item.timestamp);
            });

            stmt.finalize((err) => {
                if (err) {
                    console.error('Error finalizing statement:', err);
                    db.run("ROLLBACK");
                    reject(err);
                    return;
                }

                db.run("COMMIT", (err) => {
                    if (err) {
                        console.error('Error committing transaction:', err);
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    });
}

// Function to insert temperature reading with device ID
function insertTemperatureReading(temperature: number, deviceId: string, timestamp?: string): Promise<{ id: number, timestamp: string }> {
    return new Promise((resolve, reject) => {
        // Use provided timestamp or current time
        const actualTimestamp = timestamp || new Date().toISOString();

        db.run(
            'INSERT INTO temperature_readings (temperature, device_id, timestamp) VALUES (?, ?, ?)',
            [temperature, deviceId, actualTimestamp],
            function (err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ id: this.lastID, timestamp: actualTimestamp });
            }
        );
    });
}

// Middleware
app.use(cors({
    origin: true, // Allow all origins
    credentials: true,
    methods: '*', // Allow all methods
    allowedHeaders: '*' // Allow all headers
}));
app.use(express.json());

// Custom middleware to handle index.html with dynamic base href
app.use(async (req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
        try {
            const indexPath = path.join(__dirname, 'public', 'index.html');
            const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
            const host = req.get('host');
            const baseUrl = `${protocol}://${host}`;

            const data = await fs.promises.readFile(indexPath, 'utf8');

            // Replace the base href with the dynamic URL
            const modifiedHtml = data.replace(
                /<base href="[^"]*"\s*\/?>/i,
                `<base href="${baseUrl}/" />`
            );

            res.type('html').send(modifiedHtml);
        } catch (err) {
            res.status(500).send('Error loading page');
        }
    } else {
        next();
    }
});

// Serve other static files normally
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/temperatures', (req, res) => {
    const period = req.query.period || 'day'; // hourly, day, week, month, year
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const location = req.query.location;

    // Validate required parameters
    if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate parameters are required' });
        return;
    }

    // Validate date format
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)' });
        return;
    }

    let query = '';
    let groupBy = '';
    let dateFormat = '';

    // Determine grouping and date format based on period
    switch (period) {
        case 'hourly':
            // Return raw data for hourly view (no aggregation)
            let rawQuery = `
                SELECT temperature, device_id, timestamp, 1 as reading_count
                FROM temperature_readings
                WHERE timestamp >= ? AND timestamp < ?
            `;

            const queryParams = [startDate, endDate];

            if (location) {
                const deviceIds = getDeviceIdsForLocation(location as string);
                if (deviceIds.length === 0) {
                    res.status(400).json({ error: `Unknown location: ${location}. Valid locations are: ${getAllLocations().join(', ')}` });
                    return;
                }
                rawQuery += ` AND device_id IN (${deviceIds.map(() => '?').join(',')})`;
                queryParams.push(...deviceIds);
            }

            rawQuery += ` ORDER BY timestamp DESC`;

            db.all(rawQuery, queryParams, (err, rows) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                // Add location field derived from device_id
                const processedRows = rows.map((row: any) => ({
                    ...row,
                    location: getLocationFromDeviceId(row.device_id)
                }));

                res.json(processedRows || []);
            });
            return;

        case 'day':
            // Group by hour for daily view
            dateFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
            groupBy = "strftime('%Y-%m-%d %H', timestamp)";
            query = `WHERE timestamp >= ? AND timestamp < ? `;
            break;
        case 'week':
            // Group by day for weekly view
            dateFormat = "strftime('%Y-%m-%d', timestamp)";
            groupBy = "strftime('%Y-%m-%d', timestamp)";
            query = `WHERE timestamp >= ? AND timestamp < ? `;
            break;
        case 'month':
            // Group by day for monthly view
            dateFormat = "strftime('%Y-%m-%d', timestamp)";
            groupBy = "strftime('%Y-%m-%d', timestamp)";
            query = `WHERE timestamp >= ? AND timestamp < ? `;
            break;
        case 'year':
            // Group by month for yearly view
            dateFormat = "strftime('%Y-%m-01', timestamp)";
            groupBy = "strftime('%Y-%m', timestamp)";
            query = `WHERE timestamp >= ? AND timestamp < ? `;
            break;
        default:
            dateFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
            groupBy = "strftime('%Y-%m-%d %H', timestamp)";
            query = `WHERE timestamp >= ? AND timestamp < ? `;
    }

    let baseQuery = `
        SELECT
            ${dateFormat} as timestamp,
            device_id,
            AVG(temperature) as temperature,
            COUNT(*) as reading_count
        FROM temperature_readings
        ${query}
    `;

    const params = [startDate, endDate];

    if (location) {
        const deviceIds = getDeviceIdsForLocation(location as string);
        if (deviceIds.length === 0) {
            res.status(400).json({ error: `Unknown location: ${location}. Valid locations are: ${getAllLocations().join(', ')}` });
            return;
        }
        baseQuery += ` AND device_id IN (${deviceIds.map(() => '?').join(',')})`;
        params.push(...deviceIds);
    }

    baseQuery += `
        GROUP BY ${groupBy}, device_id
        ORDER BY timestamp ASC
    `;

    db.all(baseQuery, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        // Round temperatures to 1 decimal place and add location field
        const processedRows = rows.map((row: any) => ({
            timestamp: row.timestamp,
            location: getLocationFromDeviceId(row.device_id),
            temperature: Math.round(row.temperature * 10) / 10,
            reading_count: row.reading_count
        }));

        res.json(processedRows);
    });
});

app.get('/api/temperatures/latest', (req, res) => {
    const location = req.query.location;
    let query = `
        SELECT temperature, timestamp, device_id
        FROM temperature_readings
    `;
    const params: any[] = [];

    if (location) {
        const deviceIds = getDeviceIdsForLocation(location as string);
        if (deviceIds.length === 0) {
            res.status(400).json({ error: `Unknown location: ${location}. Valid locations are: ${getAllLocations().join(', ')}` });
            return;
        }
        query += `WHERE device_id IN (${deviceIds.map(() => '?').join(',')}) `;
        params.push(...deviceIds);
    }

    query += 'ORDER BY timestamp DESC LIMIT 1';

    db.get(query, params, (err, row: any) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (row) {
            // Add location field derived from device_id
            row.location = getLocationFromDeviceId(row.device_id);
        }

        res.json(row || {});
    });
});

app.get('/api/temperatures/stats', (req, res) => {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const location = req.query.location;

    // Validate required parameters
    if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate parameters are required' });
        return;
    }

    // Validate date format
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)' });
        return;
    }

    let whereClause = 'WHERE timestamp >= ? AND timestamp < ?';
    let params = [startDate, endDate];

    // Add location filter if specified
    if (location) {
        const deviceIds = getDeviceIdsForLocation(location as string);
        if (deviceIds.length === 0) {
            res.status(400).json({ error: `Unknown location: ${location}. Valid locations are: ${getAllLocations().join(', ')}` });
            return;
        }
        whereClause += ` AND device_id IN (${deviceIds.map(() => '?').join(',')})`;
        params.push(...deviceIds);
    }

    const query = `
        SELECT
            AVG(temperature) as avg_temp,
            MIN(temperature) as min_temp,
            MAX(temperature) as max_temp
        FROM temperature_readings
        ${whereClause}
    `;

    db.get(query, params, (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row || {});
    });
});

app.get('/api/temperatures/raw', (req, res) => {
    const timestamp = req.query.timestamp as string;
    const location = req.query.location as string;

    if (!timestamp || !location) {
        res.status(400).json({ error: 'Timestamp and location are required' });
        return;
    }

    // Get device IDs for the location
    const deviceIds = getDeviceIdsForLocation(location);
    if (deviceIds.length === 0) {
        res.status(400).json({ error: `Unknown location: ${location}. Valid locations are: ${getAllLocations().join(', ')}` });
        return;
    }

    // Parse the aggregated timestamp to determine the time range
    const targetDate = new Date(timestamp);

    let startTime: Date, endTime: Date;

    // Determine the time range based on the aggregated timestamp format
    if (timestamp.includes(':00:00')) {
        // Hourly aggregation (day view) - show all readings in that hour
        startTime = new Date(targetDate);
        endTime = new Date(targetDate.getTime() + 60 * 60 * 1000); // Add 1 hour
    } else {
        // Daily aggregation (week/month view) - show all readings in that day
        startTime = new Date(targetDate);
        startTime.setHours(0, 0, 0, 0);
        endTime = new Date(targetDate);
        endTime.setHours(23, 59, 59, 999);
    }

    const query = `
        SELECT temperature, timestamp
        FROM temperature_readings
        WHERE device_id IN (${deviceIds.map(() => '?').join(',')})
        AND timestamp >= ?
        AND timestamp < ?
        ORDER BY timestamp ASC
    `;

    const params = [...deviceIds, startTime.toISOString(), endTime.toISOString()];

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows || []);
    });
});

app.post('/api/temperature', async (req, res) => {
    const { temperature, deviceId, timestamp } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== POOLMON_API_KEY) {
        res.status(401).json({ error: 'Client provided invalid api key' });
        return;
    }

    if (!temperature || typeof temperature !== 'number') {
        res.status(400).json({ error: 'Temperature is required and must be a number' });
        return;
    }

    if (!deviceId || typeof deviceId !== 'string') {
        res.status(400).json({ error: 'Device ID is required and must be a string' });
        return;
    }

    // Validate timestamp if provided
    if (timestamp && (typeof timestamp !== 'string' || isNaN(new Date(timestamp).getTime()))) {
        res.status(400).json({ error: 'Timestamp must be a valid ISO 8601 date string' });
        return;
    }

    try {
        const result = await insertTemperatureReading(temperature, deviceId, timestamp);
        res.json({
            id: result.id,
            temperature,
            deviceId,
            timestamp: result.timestamp
        });
    } catch (error) {
        console.error('Error inserting temperature reading:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

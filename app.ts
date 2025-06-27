import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database('pool_temperature.db');

// Initialize database table
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS temperature_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            temperature REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            location TEXT DEFAULT 'pool'
        )
    `);

    // Create indexes for better query performance with large datasets
    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON temperature_readings(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_location ON temperature_readings(location)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp_location ON temperature_readings(timestamp, location)`);

    // Set SQLite performance optimizations for large datasets
    db.run(`PRAGMA journal_mode = WAL`); // Write-Ahead Logging for better concurrency
    db.run(`PRAGMA synchronous = NORMAL`); // Faster than FULL, still safe
    db.run(`PRAGMA cache_size = 10000`); // Increase cache size for better performance
    db.run(`PRAGMA temp_store = MEMORY`); // Store temporary data in memory

    // Insert dummy data if table is empty
    db.get("SELECT COUNT(*) as count FROM temperature_readings", (err, row: any) => {
        if (row.count === 0) {
            console.log('Generating dummy temperature data for the past 2 years...');
            const startTime = Date.now();

            // generate dummy data to test the app
            const dummyData = generateDummyData({
                monthsAgo: 2,
                intervalMinutes: 1
            });

            const generationTime = Date.now() - startTime;
            console.log(`Data generation took ${(generationTime / 1000).toFixed(2)} seconds`);

            console.log('Starting database insertion...');
            const insertStartTime = Date.now();

            // Use a transaction for much better performance
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");

                const stmt = db.prepare("INSERT INTO temperature_readings (temperature, location, timestamp) VALUES (?, ?, ?)");

                let insertedCount = 0;
                dummyData.forEach((data) => {
                    stmt.run(data.temp, data.location, data.timestamp);
                    insertedCount++;

                    // Log progress every 100,000 insertions
                    if (insertedCount % 100000 === 0) {
                        console.log(`Inserted ${insertedCount.toLocaleString()} records...`);
                    }
                });

                stmt.finalize((err) => {
                    if (err) {
                        console.error('Error finalizing statement:', err);
                        db.run("ROLLBACK");
                        return;
                    }

                    db.run("COMMIT", (err) => {
                        if (err) {
                            console.error('Error committing transaction:', err);
                            return;
                        }

                        const insertionTime = Date.now() - insertStartTime;
                        const totalTime = Date.now() - startTime;

                        console.log(`Database insertion took ${(insertionTime / 1000).toFixed(2)} seconds`);
                        console.log(`Total time: ${(totalTime / 1000).toFixed(2)} seconds`);
                        console.log(`Successfully inserted ${dummyData.length.toLocaleString()} temperature readings`);
                        console.log(`Average insertion rate: ${Math.round(dummyData.length / (insertionTime / 1000)).toLocaleString()} records/second`);
                    });
                });
            });
        } else {
            console.log(`Database already contains ${row.count.toLocaleString()} temperature readings`);
        }
    });
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
            location: 'pool',
            timestamp: timestamp
        });

        data.push({
            temp: Math.round(outsideTemp * 10) / 10, // Round to 1 decimal
            location: 'outside',
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

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/temperatures', (req, res) => {
    const period = req.query.period || 'day'; // hourly, day, week, month, year
    const offset = parseInt(req.query.offset as string) || 0; // -1 = previous, 0 = current, 1 = next
    const location = req.query.location;

    let query = '';
    let groupBy = '';
    let dateFormat = '';

    // Calculate date ranges based on period and offset
    const getDateRange = (period: string, offset: number) => {
        switch (period) {
            case 'hourly':
                return {
                    start: `datetime('now', '${offset - 1} hour')`,
                    end: `datetime('now', '${offset} hour')`
                };
            case 'day':
                return {
                    start: `datetime('now', '${offset - 1} day')`,
                    end: `datetime('now', '${offset} day')`
                };
            case 'week':
                const weekOffset = offset * 7;
                return {
                    start: `datetime('now', '${weekOffset - 7} day')`,
                    end: `datetime('now', '${weekOffset} day')`
                };
            case 'month':
                return {
                    start: `datetime('now', 'start of month', '${offset} month')`,
                    end: `datetime('now', 'start of month', '${offset + 1} month')`
                };
            case 'year':
                return {
                    start: `datetime('now', 'start of year', '${offset} year')`,
                    end: `datetime('now', 'start of year', '${offset + 1} year')`
                };
            default:
                return {
                    start: `datetime('now', '-1 day')`,
                    end: `datetime('now')`
                };
        }
    };

    const dateRange = getDateRange(period as string, offset);

    // Determine grouping and date format based on period
    switch (period) {
        case 'hourly':
            // Return raw data for hourly view (no aggregation)
            const startTime = new Date();
            startTime.setHours(startTime.getHours() + offset - 1);
            startTime.setMinutes(0, 0, 0);

            const endTime = new Date();
            endTime.setHours(endTime.getHours() + offset);
            endTime.setMinutes(0, 0, 0);

            let rawQuery = `
                SELECT temperature, location, timestamp, 1 as reading_count
                FROM temperature_readings
                WHERE timestamp >= ? AND timestamp < ?
            `;

            const queryParams = [startTime.toISOString(), endTime.toISOString()];

            if (location) {
                rawQuery += ` AND location = ?`;
                queryParams.push(location as string);
            }

            rawQuery += ` ORDER BY timestamp DESC`;

            db.all(rawQuery, queryParams, (err, rows) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                res.json(rows || []);
            });
            return;

        case 'day':
            // Group by hour for daily view
            dateFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
            groupBy = "strftime('%Y-%m-%d %H', timestamp)";
            query += `WHERE timestamp >= ${dateRange.start} AND timestamp < ${dateRange.end} `;
            break;
        case 'week':
            // Group by day for weekly view
            dateFormat = "strftime('%Y-%m-%d', timestamp)";
            groupBy = "strftime('%Y-%m-%d', timestamp)";
            query += `WHERE timestamp >= ${dateRange.start} AND timestamp < ${dateRange.end} `;
            break;
        case 'month':
            // Group by day for monthly view
            dateFormat = "strftime('%Y-%m-%d', timestamp)";
            groupBy = "strftime('%Y-%m-%d', timestamp)";
            query += `WHERE timestamp >= ${dateRange.start} AND timestamp < ${dateRange.end} `;
            break;
        case 'year':
            // Group by month for yearly view
            dateFormat = "strftime('%Y-%m-01', timestamp)";
            groupBy = "strftime('%Y-%m', timestamp)";
            query += `WHERE timestamp >= ${dateRange.start} AND timestamp < ${dateRange.end} `;
            break;
        default:
            dateFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
            groupBy = "strftime('%Y-%m-%d %H', timestamp)";
            query += `WHERE timestamp >= ${dateRange.start} AND timestamp < ${dateRange.end} `;
    }

    const baseQuery = `
        SELECT
            ${dateFormat} as timestamp,
            location,
            AVG(temperature) as temperature,
            COUNT(*) as reading_count
        FROM temperature_readings
        ${query}
        GROUP BY ${groupBy}, location
        ORDER BY timestamp ASC
    `;

    db.all(baseQuery, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        // Round temperatures to 1 decimal place
        const processedRows = rows.map((row: any) => ({
            timestamp: row.timestamp,
            location: row.location,
            temperature: Math.round(row.temperature * 10) / 10,
            reading_count: row.reading_count
        }));

        res.json(processedRows);
    });
});

app.get('/api/temperatures/latest', (req, res) => {
    const location = req.query.location;
    let query = `
        SELECT temperature, timestamp, location
        FROM temperature_readings
    `;
    const params: any[] = [];

    if (location) {
        query += 'WHERE location = ? ';
        params.push(location);
    }

    query += 'ORDER BY timestamp DESC LIMIT 1';

    db.get(query, params, (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row || {});
    });
});

app.get('/api/temperatures/stats', (req, res) => {
    const period = req.query.period || 'day';
    const offset = parseInt(req.query.offset as string) || 0;
    const location = req.query.location;

    let whereClause = '';
    let params: any[] = [];

    if (period === 'hourly') {
        // Use JavaScript date calculation for hourly (consistent with main endpoint)
        const startTime = new Date();
        startTime.setHours(startTime.getHours() + offset - 1);
        startTime.setMinutes(0, 0, 0);

        const endTime = new Date();
        endTime.setHours(endTime.getHours() + offset);
        endTime.setMinutes(0, 0, 0);

        whereClause = `WHERE timestamp >= ? AND timestamp < ?`;
        params = [startTime.toISOString(), endTime.toISOString()];
    } else {
        // Use SQLite date functions for other periods
        const getDateRange = (period: string, offset: number) => {
            switch (period) {
                case 'day':
                    return {
                        start: `datetime('now', '${offset - 1} day')`,
                        end: `datetime('now', '${offset} day')`
                    };
                case 'week':
                    const weekOffset = offset * 7;
                    return {
                        start: `datetime('now', '${weekOffset - 7} day')`,
                        end: `datetime('now', '${weekOffset} day')`
                    };
                case 'month':
                    return {
                        start: `datetime('now', 'start of month', '${offset} month')`,
                        end: `datetime('now', 'start of month', '${offset + 1} month')`
                    };
                case 'year':
                    return {
                        start: `datetime('now', 'start of year', '${offset} year')`,
                        end: `datetime('now', 'start of year', '${offset + 1} year')`
                    };
                default:
                    return {
                        start: `datetime('now', '-1 day')`,
                        end: `datetime('now')`
                    };
            }
        };

        const dateRange = getDateRange(period as string, offset);
        whereClause = `WHERE timestamp >= ${dateRange.start} AND timestamp < ${dateRange.end}`;
    }

    // Add location filter if specified
    if (location) {
        whereClause += ' AND location = ?';
        params.push(location as string);
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

    // Parse the aggregated timestamp to determine the time range
    const targetDate = new Date(timestamp);
    const currentPeriod = req.query.period || 'day'; // This should be passed from frontend

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
        WHERE location = ?
        AND timestamp >= ?
        AND timestamp < ?
        ORDER BY timestamp ASC
    `;

    db.all(query, [location, startTime.toISOString(), endTime.toISOString()], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows || []);
    });
});

app.post('/api/temperatures', (req, res) => {
    const { temperature, location = 'pool' } = req.body;

    if (!temperature || typeof temperature !== 'number') {
        res.status(400).json({ error: 'Temperature is required and must be a number' });
        return;
    }

    db.run(
        'INSERT INTO temperature_readings (temperature, location) VALUES (?, ?)',
        [temperature, location],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, temperature, location });
        }
    );
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

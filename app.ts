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

// Function to generate realistic dummy data
function generateDummyData() {
    const data = [];
    const now = new Date();
    const monthAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)); // 30 days ago

    // Generate readings every 30 minutes for the past month
    for (let time = monthAgo; time <= now; time = new Date(time.getTime() + 30 * 60 * 1000)) {
        const timestamp = time.toISOString();

        // Generate realistic pool temperature (varies less, typically 75-85°F)
        const basePoolTemp = 80;
        const poolVariation = Math.sin(time.getHours() / 24 * Math.PI * 2) * 3; // Daily cycle
        const poolNoise = (Math.random() - 0.5) * 2; // Small random variation
        const poolTemp = basePoolTemp + poolVariation + poolNoise;

        // Generate realistic outside temperature (varies more, seasonal + daily cycle)
        const baseOutsideTemp = 72;
        const dailyCycle = Math.sin((time.getHours() - 6) / 24 * Math.PI * 2) * 12; // Peak at 2PM
        const seasonalVariation = Math.sin(time.getDate() / 30 * Math.PI) * 8; // Monthly variation
        const outsideNoise = (Math.random() - 0.5) * 4; // More random variation
        const outsideTemp = baseOutsideTemp + dailyCycle + seasonalVariation + outsideNoise;

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
    }

    return data;
}

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

    // Insert dummy data if table is empty
    db.get("SELECT COUNT(*) as count FROM temperature_readings", (err, row: any) => {
        if (row.count === 0) {
            console.log('Generating dummy temperature data for the past month...');
            const dummyData = generateDummyData();

            const stmt = db.prepare("INSERT INTO temperature_readings (temperature, location, timestamp) VALUES (?, ?, ?)");
            dummyData.forEach((data) => {
                stmt.run(data.temp, data.location, data.timestamp);
            });
            stmt.finalize();
            console.log(`Inserted ${dummyData.length} temperature readings`);
        }
    });
});

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

            rawQuery += ` ORDER BY timestamp DESC LIMIT ${req.query.limit || 100}`;

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
            MAX(temperature) as max_temp,
            COUNT(*) as total_readings
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
        function(err) {
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

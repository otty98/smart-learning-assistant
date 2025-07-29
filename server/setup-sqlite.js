require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

async function setupDatabase() {
    try {
        // Create database directory if it doesn't exist
        const dbPath = process.env.DB_PATH || './database/ai_study_buddy.db';
        const dbDir = path.dirname(dbPath);
        
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log(`📁 Created directory: ${dbDir}`);
        }

        // Create/connect to database
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ Error opening database:', err);
                return;
            }
            console.log('✅ Connected to SQLite database');
        });

        // Enable foreign key constraints
        db.run("PRAGMA foreign_keys = ON");

        // Create Users table
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS Users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating Users table:', err);
                    reject(err);
                } else {
                    console.log('✅ Users table ready');
                    resolve();
                }
            });
        });

        // Create ChatMessages table
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS ChatMessages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId INTEGER NOT NULL,
                    subject TEXT NOT NULL,
                    sender TEXT NOT NULL CHECK(sender IN ('user', 'ai', 'system')),
                    text TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    sentiment_score REAL,
                    sentiment_magnitude REAL,
                    FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating ChatMessages table:', err);
                    reject(err);
                } else {
                    console.log('✅ ChatMessages table ready');
                    resolve();
                }
            });
        });

        // Create MoodLogs table
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS MoodLogs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId INTEGER NOT NULL,
                    subject TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    score REAL NOT NULL,
                    magnitude REAL NOT NULL,
                    message TEXT,
                    FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating MoodLogs table:', err);
                    reject(err);
                } else {
                    console.log('✅ MoodLogs table ready');
                    resolve();
                }
            });
        });

        // Close database connection
        db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('🎉 Database setup complete! You can now view it in VS Code.');
                console.log(`📁 Database location: ${dbPath}`);
                console.log('\n📋 Next steps:');
                console.log('1. Install SQLite Viewer extension in VS Code');
                console.log('2. Press Ctrl+Shift+P and type "SQLite: Open Database"');
                console.log('3. Select your database file to view tables');
                console.log('4. Run "npm run dev" to start the server');
            }
        });

    } catch (error) {
        console.error('❌ Database setup error:', error);
        process.exit(1);
    }
}

setupDatabase();
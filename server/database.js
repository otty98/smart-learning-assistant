require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Verify environment variables
if (!process.env.DB_PATH) {
    console.warn('ℹ️ DB_PATH not set, using default location');
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database', 'ai_study_buddy.db');

// Database connection reference
let dbInstance = null;

async function getDatabaseConnection() {
    if (dbInstance) return dbInstance;
    
    dbInstance = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('❌ Error opening database:', err);
            throw err;
        }
        console.log('✅ Connected to SQLite database');
        dbInstance.run("PRAGMA foreign_keys = ON");
    });
    
    return dbInstance;
}

async function setupDatabase() {
    try {
        // Create database directory
        const dbDir = path.dirname(DB_PATH);
        
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log(`📁 Created directory: ${dbDir}`);
        }

        const db = await getDatabaseConnection();

        // Create tables
        await Promise.all([
            createUsersTable(db),
            createSubjectsTable(db),
            createChatMessagesTable(db),
            createMoodLogsTable(db)
        ]);

        console.log('🎉 Database setup complete!');
        console.log(`📁 Database location: ${DB_PATH}`);

        return db;
    } catch (error) {
        console.error('❌ Database setup error:', error);
        process.exit(1);
    }
}

// Table creation functions
async function createUsersTable(db) {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS Users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                avatar_color TEXT DEFAULT '#4361ee',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME
            )
        `, (err) => {
            if (err) return reject(err);
            console.log('✅ Users table ready');
            resolve();
        });
    });
}

async function createSubjectsTable(db) {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS Subjects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL,
                icon TEXT NOT NULL
            )
        `, async (err) => {
            if (err) return reject(err);
            
            // Insert default subjects if table was just created
            const row = await new Promise(r => 
                db.get("SELECT COUNT(*) as count FROM Subjects", r)
            );
            
            if (row.count === 0) {
                await insertDefaultSubjects(db);
            }
            
            console.log('✅ Subjects table ready');
            resolve();
        });
    });
}

async function insertDefaultSubjects(db) {
    const defaultSubjects = [
        { name: 'Quantum Physics', color: '#7209b7', icon: 'atom' },
        { name: 'Molecular Biology', color: '#2a9d8f', icon: 'dna' },
        // Add other default subjects...
    ];

    await Promise.all(defaultSubjects.map(subject => {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO Subjects (name, color, icon) VALUES (?, ?, ?)`,
                [subject.name, subject.color, subject.icon],
                (err) => err ? reject(err) : resolve()
            );
        });
    }));
}

async function createChatMessagesTable(db) {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS ChatMessages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                subjectId INTEGER NOT NULL,
                sender TEXT NOT NULL CHECK(sender IN ('user', 'ai', 'system')),
                text TEXT NOT NULL,
                is_saved BOOLEAN DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                sentiment_score REAL,
                sentiment_magnitude REAL,
                FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
                FOREIGN KEY (subjectId) REFERENCES Subjects(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) return reject(err);
            console.log('✅ ChatMessages table ready');
            resolve();
        });
    });
}

async function createMoodLogsTable(db) {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS MoodLogs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                subjectId INTEGER NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                score REAL NOT NULL,
                magnitude REAL NOT NULL,
                message TEXT,
                FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
                FOREIGN KEY (subjectId) REFERENCES Subjects(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) return reject(err);
            console.log('✅ MoodLogs table ready');
            resolve();
        });
    });
}

// Export for use in other files
module.exports = {
    setupDatabase,
    getDatabaseConnection
};

// Run setup if this is the main module
if (require.main === module) {
    setupDatabase().then(db => {
        console.log('\n📋 Next steps:');
        console.log('1. Install SQLite Viewer extension in VS Code');
        console.log('2. Press Ctrl+Shift+P and type "SQLite: Open Database"');
        console.log('3. Select your database file to view tables');
        console.log('4. Run "npm run dev" to start the server');
    });
}
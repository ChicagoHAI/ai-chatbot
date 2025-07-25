const postgres = require('postgres');

async function testConnection() {
  try {
    const conn = postgres('postgresql://postgres:password@localhost:5432/ai_chatbot_local');
    const result = await conn`SELECT current_database()`;
    console.log('✅ Connection successful:', result);
    await conn.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();

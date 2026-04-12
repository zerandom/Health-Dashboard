const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Simple manual .env parser to avoid 'dotenv' dependency
function getEnv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      env[match[1]] = value;
    }
  });
  return env;
}

const envPath = path.join(__dirname, '..', '.env.local');
const envConfig = getEnv(envPath);

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function freshStart() {
  console.log('--- FRESH START: DATABASE WIPE ---');
  
  // Table 'users' might have foreign key constraints from health_data/habit_tags
  const tables = ['health_data', 'habit_tags', 'users'];
  
  for (const table of tables) {
    console.log(`Wiping table: ${table}...`);
    // Delete all records ( Supabase requires a filter, using a broad one )
    const { error } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); 
    
    if (error) {
      console.error(`Error wiping ${table}:`, error.message);
    } else {
      console.log(`Successfully initiated wipe for ${table}.`);
    }
  }

  console.log('\n--- VERIFICATION ---');
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error(`Verification failed for ${table}:`, error.message);
    } else {
      console.log(`Table ${table} now has ${count} records.`);
    }
  }
  
  console.log('\nFresh start complete. You can now re-log and re-upload.');
}

freshStart();

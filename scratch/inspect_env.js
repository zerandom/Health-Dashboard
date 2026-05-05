require('dotenv').config({ path: '.env.local' });
console.log('ENV length:', process.env.GOOGLE_API_KEY?.length);

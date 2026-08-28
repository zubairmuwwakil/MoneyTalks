import fs from 'fs';
import dotenv from 'dotenv';

const envConfig = dotenv.parse(fs.readFileSync('/Users/zub/Documents/Github_Projects/MoneyTalks/.env.local'));
const token = envConfig.MARKETLENS_API_KEY;
const baseUrl = envConfig.MARKETLENS_BASE_URL;

async function checkQuotes() {
  const reqBody = {
    symbols: ["TSLA", "PM"],
    providerKeys: {},
    options: {}
  };
  console.log(`Fetching from ${baseUrl}/quotes/equity`);
  const res = await fetch(`${baseUrl}/quotes/equity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(reqBody)
  });
  
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  try {
     console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch(e) {
     console.log(text);
  }
}

checkQuotes();

const fs = require('fs');
let code = fs.readFileSync('src/app/api/v1/wallet-events/route.test.ts', 'utf8');
code = code.replace(/const tHash = createHash\("sha256"\)\.update\(token\)\.digest\("hex"\);/, '');
code = code.replace(/const token = "mock-token";/, 'const token = "mock-token";\nconst tHash = createHash("sha256").update(token).digest("hex");\n');
fs.writeFileSync('src/app/api/v1/wallet-events/route.test.ts', code);

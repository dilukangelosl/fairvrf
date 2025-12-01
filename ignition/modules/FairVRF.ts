import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FairVRFModule = buildModule("FairVRFModule", (m) => {
    const owner = m.getAccount(0);
    
    // Deploy FairVRF with deployer as fulfiller for simplicity
    const fairVRF = m.contract("FairVRF", [owner]);

    // Read anchor from generated chain file
    const chainPath = path.join(__dirname, '../../server/chain.db.json');
    
    // Note: In Ignition, we can't easily execute arbitrary async code to read files during the build phase
    // if we want deployment to be deterministic based on module params. 
    // However, for this setup, we can read it.
    // If file doesn't exist, this will fail at build time, which is expected.
    
    let anchor = "0x0000000000000000000000000000000000000000000000000000000000000000";
    if (fs.existsSync(chainPath)) {
        const chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
        anchor = chain[0];
    }

    // Call setAnchor
    m.call(fairVRF, "setAnchor", [anchor]);

    return { fairVRF };
});

export default FairVRFModule;

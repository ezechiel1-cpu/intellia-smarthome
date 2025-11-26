import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backupData = async () => {
  const backupDir = join(__dirname, '../backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  if (!existsSync(backupDir)) {
    await mkdir(backupDir, { recursive: true });
  }

  const backup = {
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    data: {
      // Structure de sauvegarde
      lastBackup: timestamp
    }
  };

  const backupPath = join(backupDir, `backup-${timestamp}.json`);
  await writeFile(backupPath, JSON.stringify(backup, null, 2));
  
  console.log(`✅ Sauvegarde créée: ${backupPath}`);
};

backupData().catch(console.error);

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type CaptureIntegrityEntry = {
	file: string;
	sha256: string;
	size: number;
};

export type CaptureIntegrityManifest = {
	captureId: string;
	algorithm: 'SHA-256';
	createdAt: string;
	files: CaptureIntegrityEntry[];
};

export async function sha256File(filePath: string) {
	const data = await fs.readFile(filePath);
	return createHash('sha256').update(data).digest('hex');
}

export async function writeCaptureIntegrityManifest(captureId: string, folder: string, filePaths: string[]) {
	const files: CaptureIntegrityEntry[] = [];
	for (const filePath of filePaths.filter(Boolean)) {
		const stat = await fs.stat(filePath);
		files.push({
			file: path.basename(filePath),
			sha256: await sha256File(filePath),
			size: stat.size
		});
	}
	const manifest: CaptureIntegrityManifest = {
		captureId,
		algorithm: 'SHA-256',
		createdAt: new Date().toISOString(),
		files
	};
	const integrityDir = path.join(folder, '_integrity');
	await fs.mkdir(integrityDir, { recursive: true });
	const manifestPath = path.join(integrityDir, `${captureId}.json`);
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
	return { manifestPath, manifest };
}

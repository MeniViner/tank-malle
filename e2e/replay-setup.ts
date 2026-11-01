import emulatorSetup from './global-setup';
import { writeScenes } from './helpers/replay';

/** Render the replay scenes (once per source change), then the usual emulator setup. */
export default async function replaySetup(): Promise<void> {
  await writeScenes();
  await emulatorSetup();
}

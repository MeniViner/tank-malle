import { test } from '@playwright/test';
import { restoredArchiveFollowupFlow } from './helpers/vehicle-archive';
test('restoring before an archive follow-up finishes keeps the active vehicle and retires only the obsolete intent', async ({ page }) => restoredArchiveFollowupFlow(page));

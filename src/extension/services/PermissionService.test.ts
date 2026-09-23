import { describe, expect, it } from 'vitest';
import { PermissionService } from './PermissionService';

describe('PermissionService', () => {
  it('resolves all concurrent requests for the same file', async () => {
    const service = new PermissionService();
    const first = service.waitForReadPermission('config/.env');
    const second = service.waitForReadPermission('config/.env');

    service.grantReadPermission('config/.env', 'allow');

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it('does not overwrite a pending resolver', async () => {
    const service = new PermissionService();
    const first = service.waitForReadPermission('config/.env');
    const second = service.waitForReadPermission('config/.env');

    service.grantReadPermission('config/.env', 'deny');

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });

  it('caches remembered permission by file path across matching deny patterns', async () => {
    const service = new PermissionService();
    const pending = service.waitForReadPermission('node_modules/pkg/.env.local');

    service.grantReadPermission('node_modules/pkg/.env.local', 'allow', true);

    await expect(pending).resolves.toBe(true);
    expect(service.isReadAllowed('node_modules/pkg/.env.local')).toEqual({ allowed: true });
    await expect(service.waitForReadPermission('node_modules/pkg/.env.local')).resolves.toBe(true);
  });

  it('does not cache one-time permission', async () => {
    const service = new PermissionService();
    const pending = service.waitForReadPermission('config/.env');

    service.grantReadPermission('config/.env', 'allow', false);

    await expect(pending).resolves.toBe(true);
    expect(service.isReadAllowed('config/.env')).toMatchObject({ allowed: false });
  });
});

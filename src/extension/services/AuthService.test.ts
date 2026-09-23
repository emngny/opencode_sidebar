import { describe, it, expect, vi } from 'vitest';
import { AuthService } from './AuthService';

describe('AuthService', () => {
  const mockContext = {
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as any;

  const mockApiClient = {
    getProviderAuth: vi.fn().mockResolvedValue({}),
    setAuth: vi.fn().mockResolvedValue(true),
    removeAuth: vi.fn().mockResolvedValue(undefined),
  };
  const mockOpencode = {
    getApiClient: vi.fn().mockReturnValue(mockApiClient),
  } as any;

  it('should be instantiable', () => {
    const authService = new AuthService(mockOpencode, mockContext);
    expect(authService).toBeDefined();
  });

  it('uses the OpencodeCli shared API client', async () => {
    const authService = new AuthService(mockOpencode, mockContext);

    await authService.setApiKey('provider', 'secret');

    expect(mockOpencode.getApiClient).toHaveBeenCalledOnce();
    expect(mockApiClient.setAuth).toHaveBeenCalledWith('provider', 'secret');
  });
});

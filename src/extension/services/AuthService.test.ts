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

  const mockOpencode = {
    url: 'http://localhost:1234',
    authHeader: { Authorization: 'Basic abc' },
  } as any;

  it('should be instantiable', () => {
    const authService = new AuthService(mockOpencode, mockContext);
    expect(authService).toBeDefined();
  });
});
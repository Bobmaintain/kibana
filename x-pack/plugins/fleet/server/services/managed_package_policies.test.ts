/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, savedObjectsClientMock } from 'src/core/server/mocks';

import type { Installation } from '../../common';

import { shouldUpgradePolicies, upgradeManagedPackagePolicies } from './managed_package_policies';
import { packagePolicyService } from './package_policy';
import { getInstallation } from './epm/packages';

jest.mock('./package_policy');
jest.mock('./epm/packages');
jest.mock('./app_context', () => {
  return {
    ...jest.requireActual('./app_context'),
    appContextService: {
      getLogger: jest.fn(() => {
        return { error: jest.fn() };
      }),
    },
  };
});

describe('upgradeManagedPackagePolicies', () => {
  afterEach(() => {
    (packagePolicyService.get as jest.Mock).mockReset();
    (packagePolicyService.getUpgradeDryRunDiff as jest.Mock).mockReset();
    (getInstallation as jest.Mock).mockReset();
    (packagePolicyService.upgrade as jest.Mock).mockReset();
  });

  it('should not upgrade policies for non-managed package', async () => {
    const esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
    const soClient = savedObjectsClientMock.create();

    (packagePolicyService.get as jest.Mock).mockImplementationOnce(
      (savedObjectsClient: any, id: string) => {
        return {
          id,
          inputs: {},
          version: '',
          revision: 1,
          updated_at: '',
          updated_by: '',
          created_at: '',
          created_by: '',
          package: {
            name: 'non-managed-package',
            title: 'Non-Managed Package',
            version: '1.0.0',
          },
        };
      }
    );

    (packagePolicyService.getUpgradeDryRunDiff as jest.Mock).mockImplementationOnce(
      (savedObjectsClient: any, id: string) => {
        return {
          name: 'non-managed-package-policy',
          diff: [{ id: 'foo' }, { id: 'bar' }],
          hasErrors: false,
        };
      }
    );

    (getInstallation as jest.Mock).mockResolvedValueOnce({
      id: 'test-installation',
      version: '0.0.1',
      keep_policies_up_to_date: false,
    });

    await upgradeManagedPackagePolicies(soClient, esClient, ['non-managed-package-id']);

    expect(packagePolicyService.upgrade).not.toBeCalled();
  });

  it('should upgrade policies for managed package', async () => {
    const esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
    const soClient = savedObjectsClientMock.create();

    (packagePolicyService.get as jest.Mock).mockImplementationOnce(
      (savedObjectsClient: any, id: string) => {
        return {
          id,
          inputs: {},
          version: '',
          revision: 1,
          updated_at: '',
          updated_by: '',
          created_at: '',
          created_by: '',
          package: {
            name: 'managed-package',
            title: 'Managed Package',
            version: '0.0.1',
          },
        };
      }
    );

    (packagePolicyService.getUpgradeDryRunDiff as jest.Mock).mockImplementationOnce(
      (savedObjectsClient: any, id: string) => {
        return {
          name: 'non-managed-package-policy',
          diff: [{ id: 'foo' }, { id: 'bar' }],
          hasErrors: false,
        };
      }
    );

    (getInstallation as jest.Mock).mockResolvedValueOnce({
      id: 'test-installation',
      version: '1.0.0',
      keep_policies_up_to_date: true,
    });

    await upgradeManagedPackagePolicies(soClient, esClient, ['managed-package-id']);

    expect(packagePolicyService.upgrade).toBeCalledWith(soClient, esClient, ['managed-package-id']);
  });

  describe('when dry run reports conflicts', () => {
    it('should return errors + diff without performing upgrade', async () => {
      const esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
      const soClient = savedObjectsClientMock.create();

      (packagePolicyService.get as jest.Mock).mockImplementationOnce(
        (savedObjectsClient: any, id: string) => {
          return {
            id,
            inputs: {},
            version: '',
            revision: 1,
            updated_at: '',
            updated_by: '',
            created_at: '',
            created_by: '',
            package: {
              name: 'conflicting-package',
              title: 'Conflicting Package',
              version: '0.0.1',
            },
          };
        }
      );

      (packagePolicyService.getUpgradeDryRunDiff as jest.Mock).mockImplementationOnce(
        (savedObjectsClient: any, id: string) => {
          return {
            name: 'conflicting-package-policy',
            diff: [
              { id: 'foo' },
              { id: 'bar', errors: [{ key: 'some.test.value', message: 'Conflict detected' }] },
            ],
            hasErrors: true,
          };
        }
      );

      (getInstallation as jest.Mock).mockResolvedValueOnce({
        id: 'test-installation',
        version: '1.0.0',
        keep_policies_up_to_date: true,
      });

      const result = await upgradeManagedPackagePolicies(soClient, esClient, [
        'conflicting-package-policy',
      ]);

      expect(result).toEqual([
        {
          packagePolicyId: 'conflicting-package-policy',
          diff: [
            {
              id: 'foo',
            },
            {
              id: 'bar',
              errors: [
                {
                  key: 'some.test.value',
                  message: 'Conflict detected',
                },
              ],
            },
          ],
          errors: [
            {
              key: 'some.test.value',
              message: 'Conflict detected',
            },
          ],
        },
      ]);

      expect(packagePolicyService.upgrade).not.toBeCalled();
    });
  });
});

describe('shouldUpgradePolicies', () => {
  describe('package policy is up-to-date', () => {
    describe('keep_policies_up_to_date is true', () => {
      it('returns false', () => {
        const installedPackage = {
          version: '1.0.0',
          keep_policies_up_to_date: true,
        };

        const result = shouldUpgradePolicies('1.0.0', installedPackage as Installation);

        expect(result).toBe(false);
      });
    });

    describe('keep_policies_up_to_date is false', () => {
      it('returns false', () => {
        const installedPackage = {
          version: '1.0.0',
          keep_policies_up_to_date: false,
        };

        const result = shouldUpgradePolicies('1.0.0', installedPackage as Installation);

        expect(result).toBe(false);
      });
    });
  });

  describe('package policy is out-of-date', () => {
    describe('keep_policies_up_to_date is true', () => {
      it('returns true', () => {
        const installedPackage = {
          version: '1.1.0',
          keep_policies_up_to_date: true,
        };

        const result = shouldUpgradePolicies('1.0.0', installedPackage as Installation);

        expect(result).toBe(true);
      });
    });

    describe('keep_policies_up_to_date is false', () => {
      it('returns false', () => {
        const installedPackage = {
          version: '1.1.0',
          keep_policies_up_to_date: false,
        };

        const result = shouldUpgradePolicies('1.0.0', installedPackage as Installation);

        expect(result).toBe(false);
      });
    });
  });
});

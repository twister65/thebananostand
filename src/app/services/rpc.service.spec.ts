import { of, throwError } from 'rxjs';
import { RpcService } from './rpc.service';

describe('RpcService RsBan RPC compatibility', () => {
    const address = 'ban_test';
    const url = 'http://127.0.0.1:7072';
    const hash = 'A'.repeat(64);

    function setup(handler: (payload: any) => any) {
        const post = jasmine.createSpy('post').and.callFake((_url: string, payload: any) => handler(payload));
        const datasource = {
            getRpcSource: jasmine.createSpy('getRpcSource').and.resolveTo({ url }),
        };
        const util = {
            convertBanToRaw: jasmine.createSpy('convertBanToRaw').and.returnValue('100'),
            convertRawToBan: jasmine.createSpy('convertRawToBan').and.returnValue(1),
        };
        const service = new RpcService(util as any, datasource as any, null as any, { post } as any);
        return { service, post, datasource, util };
    }

    it('reads confirmed receivables from RsBan without a legacy call', async () => {
        const { service, post, util } = setup(() => of({
            blocks: { [hash]: { amount: '100', source: address } },
        }));
        const result = await service.getReceivableTransactions(address, 25, 0.01);
        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith(url, {
            action: 'receivable', account: address, count: '25', threshold: '100',
            source: 'true', include_only_confirmed: 'true',
        });
        expect(util.convertBanToRaw).toHaveBeenCalledWith(0.01);
        expect(result).toEqual([{ hash, address, amountRaw: '100', amount: 1 }]);
    });

    it('uses legacy pending only after explicit proxy refusal', async () => {
        const { service, post } = setup((payload) => payload.action === 'receivable'
            ? throwError({ status: 500, error: { error: 'Action receivable not allowed' } })
            : of({ blocks: {} }));
        expect(await service.getReceivableTransactions(address, 1, 0)).toEqual([]);
        expect(post.calls.allArgs().map((args) => args[1].action)).toEqual(['receivable', 'pending']);
        expect(post.calls.allArgs().map((args) => args[0])).toEqual([url, url]);
    });

    it('does not retry another action on an unrelated server failure', async () => {
        const { service, post } = setup(() => throwError({ status: 500, error: { error: 'Internal server error' } }));
        await expectAsync(service.getReceivableTransactions(address, 1, 0)).toBeRejected();
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed receivable responses', async () => {
        const { service } = setup(() => of({ blocks: { [hash]: '100' } }));
        await expectAsync(service.getReceivableTransactions(address, 1, 0)).toBeRejectedWithError(
            'Invalid receivable RPC block entry'
        );
    });

    it('propagates failed fallback requests', async () => {
        const { service, post } = setup((payload) => payload.action === 'receivable'
            ? of({ error: 'Unknown command' })
            : throwError({ status: 503 }));
        await expectAsync(service.getReceivableTransactions(address, 1, 0)).toBeRejected();
        expect(post).toHaveBeenCalledTimes(2);
    });
});

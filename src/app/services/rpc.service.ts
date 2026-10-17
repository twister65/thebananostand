import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { ReceivableTx } from '@app/types/ReceivableTx';
import { UtilService } from './util.service';
import { AccountInfoResponse } from '@dev-ptera/nano-node-rpc';
import { AccountOverview } from '@app/types/AccountOverview';
import { DatasourceService } from '@app/services/datasource.service';
import { SignerService } from '@app/services/signer.service';
import { TransactionBlock } from '@app/types/TransactionBlock';

const LOG_ERR = (err: any): any => {
    console.error(`ERROR: Issue fetching RPC data.  ${err}`);
    return err;
};

type UnopenedAccountResponse = {
    unopenedAccount: true;
};

@Injectable({
    providedIn: 'root',
})
/** RPC calls using the nano RPC and the @dev-ptera/nano-node-rpc client.
 *
 *  All functions in this service can have its NanoClient datasource switched without any issues.
 * */
export class RpcService {
    constructor(
        private readonly _util: UtilService,
        private readonly _datasourceService: DatasourceService,
        private readonly _signerService: SignerService,
        private readonly _http: HttpClient
    ) {}

    /** Returns number of confirmed transactions an account has. */
    async getAccountHeight(address: string): Promise<number> {
        const client = await this._datasourceService.getRpcClient();
        const accountInfo = await client.account_info(address).catch((err) => Promise.reject(LOG_ERR(err)));
        return Number(accountInfo.confirmation_height);
    }

    /** Returns a modified account info object, given an index. */
    // Make this accept a public address, yeah? // TODO
    async getAccountInfoFromIndex(index: number, address?: string): Promise<AccountOverview> {
        let publicAddress = address;
        if (!publicAddress) {
            publicAddress = await this._signerService.getAccountFromIndex(index);
        }
        const client = await this._datasourceService.getRpcClient();
        const accountInfoRpc = await client.account_info(publicAddress, { representative: true }).catch((err) => {
            if (err.error === 'Account not found') {
                return Promise.resolve({
                    unopenedAccount: true,
                } as UnopenedAccountResponse);
            }
            throw LOG_ERR(err);
        });
        const accountOverview = this._formatAccountInfoResponse(index, publicAddress, accountInfoRpc);
        return accountOverview;
    }

    /** Handles some data formatting; transforms account_info rpc data into some formatted dashboard data. */
    private _formatAccountInfoResponse(
        index: number,
        address: string,
        rpcData: AccountInfoResponse | UnopenedAccountResponse
    ): AccountOverview {
        // If account is not opened, return a placeholder account.
        if ((rpcData as UnopenedAccountResponse).unopenedAccount) {
            return {
                index,
                shortAddress: this._util.shortenAddress(address),
                fullAddress: address,
                formattedBalance: '0',
                blockCount: 0,
                balance: 0,
                lastUpdatedTimestamp: undefined,
                balanceRaw: '0',
                frontier: undefined,
                representative: undefined,
                pending: [],
            };
        }

        const accountInfo = rpcData as AccountInfoResponse;
        const balance = this._util.convertRawToBan(accountInfo.balance);

        return {
            index,
            pending: [],
            balance: Number(balance),
            balanceRaw: accountInfo.balance,
            fullAddress: address,
            blockCount: Number(accountInfo.block_count),
            lastUpdatedTimestamp: accountInfo.modified_timestamp,
            shortAddress: this._util.shortenAddress(address),
            formattedBalance: this._util.numberWithCommas(balance, 6),
            representative: accountInfo.representative,
            frontier: accountInfo.frontier,
        };
    }

    /** Read confirmed receivable blocks directly from the selected Banano RPC node.
     *
     *  The standalone RPC client currently only exposes accounts_pending, so this
     *  uses HttpClient for the modern single-account receivable action. Retry the
     *  legacy name only if the server explicitly rejects the modern action.
     *  Never switch to another RPC endpoint as part of a retry.
     */
    async getReceivableTransactions(address: string, count: number, thresholdBan: number): Promise<ReceivableTx[]> {
        const source = await this._datasourceService.getRpcSource();
        const options = {
            account: address,
            count: String(count),
            threshold: this._util.convertBanToRaw(thresholdBan),
            source: 'true',
            include_only_confirmed: 'true',
        };
        type ReceivableResponse = {
            blocks: { [hash: string]: { amount: string; source?: string } };
            error?: string;
        };
        const request = async (action: 'receivable' | 'pending'): Promise<ReceivableResponse> => {
            const response = await lastValueFrom(
                this._http.post<ReceivableResponse>(source.url, { action, ...options })
            );
            if (response?.error) {
                throw new Error(response.error);
            }
            return response;
        };

        let response: ReceivableResponse;
        try {
            response = await request('receivable');
        } catch (err) {
            const reason = err?.error?.error || err?.error || err?.message;
            if (reason !== 'Action receivable not allowed' && reason !== 'Unknown command') {
                throw err;
            }
            // An older node or an RPC proxy might only accept the legacy action.
            response = await request('pending');
        }

        if (!response?.blocks || Array.isArray(response.blocks) || typeof response.blocks !== 'object') {
            throw new Error('Invalid receivable RPC response');
        }
        return Object.entries(response.blocks).map(([hash, pending]) => {
            if (!pending || typeof pending.amount !== 'string') {
                throw new Error('Invalid receivable RPC block entry');
            }
            return {
                hash,
                address: pending.source,
                amountRaw: pending.amount,
                amount: this._util.convertRawToBan(pending.amount),
            };
        });
    }

    /** Given a hash, tells our RPC datasource to stop calculating work to process a transaction. */
    async cancelWorkGenerate(hash: string): Promise<any> {
        const client = await this._datasourceService.getRpcClient();
        // eslint-disable-next-line no-console
        console.log('Canceling server-side work generate request');
        return new Promise((resolve) => {
            client.work_cancel(hash).then(resolve).catch(resolve);
        });
    }

    async generateWork(hash: string): Promise<string> {
        const client = await this._datasourceService.getRpcClient();
        const response = await client.work_generate(hash);
        return response.work;
    }

    async process(block: TransactionBlock, type: 'send' | 'receive' | 'change' | 'open'): Promise<string> {
        const client = await this._datasourceService.getRpcClient();
        const datasource = await this._datasourceService.getRpcSource();
        const processReq = {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            json_block: true,
            subtype: type,
            block: block,
        };

        // Kalium specific.
        if (block.work === undefined && datasource.alias === 'Kalium') {
            processReq['do_work'] = true;
        }
        const response = await client.process(processReq);
        return response.hash;
    }
}

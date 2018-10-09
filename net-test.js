/*!
 * Tests the swap.js functions on active testnet:
 * Script will output a funding address and wait for
 * incoming tx to that address, then react immediately
 * with the specified redeem transaction, all on one chain only.
 */

// set these for each test -------!!
const lib = 'bcoin';    // bcoin, bcash
const mode = 'refund';  // refund, swap
// -------------------------------!!

const {NodeClient, WalletClient} = require('bclient');
const {BloomFilter} = require('bfilter');
const Swap = require('./swap');
const network = 'testnet';

const swap = new Swap(lib);

const nodePort = (lib == 'bcoin') ? 18332 : 18032;
const walletPort = (lib == 'bcoin') ? 18334 : 18034;

const client = new NodeClient({
  network: 'testnet',
  port: nodePort,
  apiKey: 'api-key'
});

const wallet = new WalletClient({
  network: 'testnet',
  port: walletPort,
  apiKey: 'api-key'
});

const secret = swap.getSecret();
const Timmy = swap.getKeyPair();
const Chris = swap.getKeyPair();

let redeemScript, address, CLTV_LOCKTIME, TX_nSEQUENCE;

(async () => {
  CLTV_LOCKTIME = 60 * 10; // can't spend redeem until ten minutes pass
  TX_nSEQUENCE = 60 * 10;  // minimum height the funding tx can be mined

  console.log('Timmy:\n', Timmy, '\nChris:\n', Chris);

  redeemScript = swap.getRedeemScript(
    secret.hash,
    Timmy.publicKey,
    Chris.publicKey,
    CLTV_LOCKTIME
  );

  const addrFromScript = swap.getAddressFromRedeemScript(redeemScript);
  const address = addrFromScript.toString(network);

  console.log(
    'Swap P2SH scriptPubKey:\n',
    redeemScript.hash160().toString('hex')
  );
  console.log('Swap P2SH address:\n', address);

  const walletName = swap.nameWallet(address);
  await wallet.createWallet(walletName, {watchOnly: true});
  
  const watchWallet = wallet.wallet(walletName);
  await watchWallet.importAddress('default', address);
  
  const watchWalletInfo = await watchWallet.getInfo();
  console.log('Watch-only wallet created:\n', watchWalletInfo);

  await wallet.open();
  await wallet.join(walletName, watchWalletInfo.token);
})();

switch (mode) {
  case 'refund': {
    wallet.bind('confirmed', async (wallet, fundingTX) => {
      const refundScript = swap.getRefundInputScript(redeemScript);
      const refundTX = swap.getRedeemTX(
        Timmy.address,
        2000,
        swap.TX.fromRaw(fundingTX.tx, 'hex'),
        0,
        redeemScript,
        refundScript,
        TX_nSEQUENCE,
        Timmy.privateKey
      );

      const finalTX = refundTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');

      console.log('Refund TX:\n', finalTX);

      // this requires timeout to be HUUUUGE in brq/lib/request.js
      // wait twenty minutes and try again
      console.log('Waiting 20 minutes...')
      setTimeout(async () => {
        const broadcastResult2 = await client.broadcast(stringTX);
        console.log('Broadcast TX 20 min later: ', broadcastResult2);
      }, 60 * 20 * 1000);
    });
    break;
  }
  case 'swap': {
    wallet.bind('tx', async (wallet, fundingTX) => {
      console.log('Funding TX Received:\n', fundingTX);
      const swapScript = swap.getSwapInputScript(redeemScript, secret.secret);
      const swapTX = swap.getRedeemTX(
        Chris.address,
        2000,
        swap.TX.fromRaw(fundingTX.tx, 'hex'),
        0,
        redeemScript,
        swapScript,
        null,
        Chris.privateKey
      );

      const finalTX = swapTX.toTX();
      const stringTX = finalTX.toRaw().toString('hex');

      console.log('Swap TX:\n', finalTX);

      const broadcastResult = await client.broadcast(stringTX);

      console.log('Broadcast TX: ', broadcastResult);
    });
    break;
  }
}

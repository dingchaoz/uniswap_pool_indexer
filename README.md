
# Uniswap Pool Exporter

`get-pairs.js` is a script designed to fetch logs from Uniswap V2 and V3 for specific tokens and export the data into JSON files. The script extracts information such as token symbols, pool addresses, and other relevant data, which is then saved in a structured directory format for easy access and analysis.

## Features

- Fetch logs from Uniswap V2 and V3 based on a specific token address.
- Retrieve token symbols for better identification and organization of data.
- Export data into JSON files, organized by network and token symbol.

## Installation

Before using the script, ensure you have [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) installed.

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/uniswap-pool-exporter.git
   cd uniswap-pool-exporter
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your environment:

   Create a `.env` file in the root directory of the project and add your Alchemy API key:

   ```bash
   ALchemy_API_KEY=your_alchemy_api_key_here
   ```

   Replace `your_alchemy_api_key_here` with your actual Alchemy API key.

## Usage

To run the script, use the following command:

```bash
node get-pairs.js <network> <tokenAddress>
```

- `<network>`: The Ethereum network to use (e.g., `mainnet`, `ropsten`, `rinkeby`, `goerli`, `kovan`, `matic`, `mumbai`).
- `<tokenAddress>`: The contract address of the token you want to fetch logs for.

### Example

```bash
node get-pairs.js mainnet 0x0f5d2fb29fb7d3cfee444a200298f468908cc942
```

This command fetches logs for the MANA token on the Ethereum mainnet.

## Output

The script creates an output file in the format:

```
<tokenSymbol>/<network>/<tokenAddress>/<version>.json
```

For example, if you query the `mainnet` for the MANA token, the output would be:

```
MANA/mainnet/0x0f5d2fb29fb7d3cfee444a200298f468908cc942/v2.json
MANA/mainnet/0x0f5d2fb29fb7d3cfee444a200298f468908cc942/v3.json
```

## Tokens
### Mana
- CMC: https://coinmarketcap.com/currencies/decentraland/
- Pools: 
   - Mainnet: https://app.uniswap.org/explore/tokens/ethereum/0x0f5d2fb29fb7d3cfee444a200298f468908cc942
- Networks:
   - Mainnet: 0x0f5d2fb29fb7d3cfee444a200298f468908cc942

### GHST
- CMC: https://coinmarketcap.com/currencies/aavegotchi/
- Pools: 
   - Mainnet: https://app.uniswap.org/explore/tokens/ethereum/0x3f382dbd960e3a9bbceae22651e88158d2791550
   - Polygon: https://app.uniswap.org/explore/tokens/polygon/0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7
- Networks:
   - Mainnet: 0x3F382DbD960E3a9bbCeaE22651E88158d2791550
   - Matic: 0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7
   - Base: 0xcD2F22236DD9Dfe2356D7C543161D4d260FD9BcB

### IXT
- CMC: https://coinmarketcap.com/currencies/ix-token/
- Pools: 
   - Matic: https://app.uniswap.org/explore/tokens/polygon/0xe06bd4f5aac8d0aa337d13ec88db6defc6eaeefe
- Networks:
   - Matic: 0xe06bd4f5aac8d0aa337d13ec88db6defc6eaeefe
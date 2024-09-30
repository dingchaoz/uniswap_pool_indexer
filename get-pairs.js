require('dotenv').config();
const { ALCHEMY_API_KEY } = process.env;
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');


const ERC20_ABI = [
    "function symbol() view returns (string)"
];

const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const PAIR_CREATED_TOPIC = ethers.id("PairCreated(address,address,address,uint256)");
const POOL_CREATED_TOPIC = ethers.id("PoolCreated(address,address,uint24,int24,address)");

const PAIR_CREATED_ABI_TYPES =  [
    "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline)",
    "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)",
    "function migrate(address token, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline)"
];
const POOL_CREATED_ABI_TYPES = [
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
  ];

async function getTokenSymbol(provider, tokenAddress) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    try {
        return await tokenContract.symbol();
    } catch (error) {
        console.error(`Failed to fetch token symbol for address ${tokenAddress}:`, error);
        return tokenAddress; 
    }
}

async function fetchLogs(provider, manaAddress, factoryAddress, topic, decoder, abiTypes) {
    const filter = {
        address: factoryAddress,
        topics: [topic, ethers.zeroPadValue(manaAddress, 32)],
        fromBlock: 0,
        toBlock: 'latest'
    };

    const logs = await provider.getLogs(filter);
    console.log('===logs', logs)
    const results = [];

    for (const log of logs) {
        const parsedLog = decoder(log.data, abiTypes);
        const token0 = ethers.getAddress('0x' + log.topics[1].slice(26));
        const token1 = ethers.getAddress('0x' + log.topics[2].slice(26));
        const txHash = log.transactionHash;
        const eventBlock = log.blockNumber;
        const transaction = await provider.getTransaction(txHash);
        const creator = transaction.from;

        const iface = new ethers.Interface(abiTypes);
        const data = transaction.data;
        const dataDecoded = iface.parseTransaction({ data });

        // Extract parameter names and values
        const dataParamNames = dataDecoded.fragment.inputs.map(input => input.name);
        const dataParamValues = dataDecoded.args;
    
        const transactionInputDataMap = {}
        dataParamNames.forEach((name, index) => {
            // console.log(`${name}: ${dataParamValues[index]}`);
            transactionInputDataMap[`input-${name}`] = dataParamValues[index]
        });

        const transactionFunction = dataDecoded.name

        results.push({
            token0,
            token1,
            parsedLog,
            txHash,
            eventBlock,
            creator,
            ...transactionInputDataMap,
            transactionFunction,
        });
    }

    return results;
}

async function handleLogs(logs, network, uniswapVersion, tokenAddress) {
    const logData = [];
    const provider = new ethers.AlchemyProvider(network, ALCHEMY_API_KEY);

    const tokenSymbol = await getTokenSymbol(provider, tokenAddress);

    for (const log of logs) {
        const { token0, token1, parsedLog, txHash, eventBlock, creator, transactionFunction, ...data } = log;
        
        const token0Symbol = await getTokenSymbol(provider, token0);
        const token1Symbol = await getTokenSymbol(provider, token1);

        let logInfo = {
            network,
            uniswapVersion,
            token0,
            token0Symbol,
            token1,
            token1Symbol,
            eventBlock,
            creator,
            txHash,
            transactionFunction,
        };

        if (uniswapVersion === 'v2') {
            logInfo.pairAddress = parsedLog[0];
            logInfo['input-token'] = data['input-token']
            logInfo['input-amountTokenDesired'] = data['input-amountTokenDesired']
            logInfo['input-amountTokenMin'] = data['input-amountTokenMin']
            logInfo['input-amountETHMin'] = data['input-amountETHMin']
            logInfo['input-to'] = data['input-to']
            logInfo['input-deadline'] = data['input-deadline']
            logInfo['input-tokenA'] = data['input-tokenA']
            logInfo['input-tokenB'] = data['input-tokenB']
            logInfo['input-amountADesired'] = data['input-amountADesired']
            logInfo['input-amountBDesired'] = data['input-amountBDesired']
            logInfo['input-amountAMin'] = data['input-amountAMin']
            logInfo['input-amountBMin'] = data['input-amountBMin']
        } else if (uniswapVersion === 'v3') {
            logInfo.tickSpacing = parsedLog[0];
            logInfo.poolAddress = parsedLog[1];
        }

        logData.push(logInfo);
    }

    // Generate directory path and filename with token symbol
    const dirPath = path.join('ptest2', tokenSymbol, network, tokenAddress);
    const filename = `${uniswapVersion}.json`;
    const filePath = path.join(dirPath, filename);

    writeToFile(logData, filePath, true);

    // if (logData.length) {
    //     const logData2 = Object.keys(logData[0]).join(',') + '\n' + logData.map((logDataContent) => Object.values(logDataContent).join(',')).join('\n')
    //     const filename2 = `${uniswapVersion}.csv`;
    //     const filePath2 = path.join(dirPath, filename2);
    //     writeToFile(logData2, filePath2);
    // }
}

function writeToFile(data, filePath, convertToString) {
    if (!convertToString) {
        fs.writeFileSync(filePath, data);
    } else {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Convert BigInt to string for JSON serialization
        const jsonString = JSON.stringify(data, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value,
            2
        );
        fs.writeFileSync(filePath, jsonString);
    }
    console.log(`Data successfully written to ${filePath}`);
}

async function main(networkInput, manaAddress) {
    const provider = new ethers.AlchemyProvider(networkInput, ALCHEMY_API_KEY);

    const logsV2 = await fetchLogs(
        provider,
        manaAddress,
        UNISWAP_V2_FACTORY,
        PAIR_CREATED_TOPIC,
        (data) => ethers.AbiCoder.defaultAbiCoder().decode(['address'], data),
        PAIR_CREATED_ABI_TYPES,
    );

    // const logsV3 = await fetchLogs(
    //     provider,
    //     manaAddress,
    //     UNISWAP_V3_FACTORY,
    //     POOL_CREATED_TOPIC,
    //     (data) => ethers.AbiCoder.defaultAbiCoder().decode(['int24', 'address'], data)
    // );

    await Promise.all([
        handleLogs(logsV2, networkInput, 'v2', manaAddress),
        // handleLogs(logsV3, networkInput, 'v3', manaAddress)
    ]);
}

const args = process.argv.slice(2);
const networkInput = args[0] || 'mainnet';
const manaAddress = args[1] || '0x0f5d2fb29fb7d3cfee444a200298f468908cc942';

main(networkInput, manaAddress).catch(console.error);

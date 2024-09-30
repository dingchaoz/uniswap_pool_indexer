// require('dotenv').config();
// const { ethers } = require('ethers');
// const fs = require('fs');
// const path = require('path');

import * as dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers'
import fs from 'fs'
import path from 'path'
import { request, gql } from 'graphql-request';


const { ALCHEMY_API_KEY, THEGRAPH_API_KEY } = process.env;

const ERC20_ABI = [
    "function symbol() view returns (string)"
];

// const UNISWAP_V2_FACTORY = '';
// const UNISWAP_V3_FACTORY = '';
// const QUICKSWAP_V3_FACTORY = '';
const UNISWAP_POOL_MINT_TOPIC = ethers.id("Mint(address,address,int24,int24,uint128,uint256,uint256)");

const dataMap = {
    uniswap: {
        v2: {
            factoryPCreatedTopic: ethers.id("PairCreated(address,address,address,uint256)"),
            // "indexed": false,
            decoder: (data) => ethers.AbiCoder.defaultAbiCoder().decode(['address'], data),
            mainnet: {
                factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
                theGraphEndpoint: `https://gateway.thegraph.com/api/${THEGRAPH_API_KEY}/subgraphs/id/A3Np3RQbaBA6oKJgiwDJeo5T3zrYfGHPWFYayMwtNDum`,
            }
        },
        v3: {
            factoryPCreatedTopic: ethers.id("PoolCreated(address,address,uint24,int24,address)"),
            decoder: (data) => ethers.AbiCoder.defaultAbiCoder().decode(['int24', 'address'], data),
            mainnet: {
                factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                theGraphEndpoint: `https://gateway.thegraph.com/api/${THEGRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`,
            },
            base: {
                factoryAddress: '0x33128a8fc17869897dce68ed026d694621f6fdfd',
                theGraphEndpoint: `https://gateway.thegraph.com/api/${THEGRAPH_API_KEY}/subgraphs/id/43Hwfi3dJSoGpyas9VwNoDAv55yjgGrPpNSmbQZArzMG`,
            },
        }
    },
    quickswap: {
        v3: {
            factoryPCreatedTopic: ethers.id("Pool(address,address,address)"),
            decoder: (data) => ethers.AbiCoder.defaultAbiCoder().decode(['address'], data),
            matic: {
                factoryAddress: '0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28',
                theGraphEndpoint: `https://gateway.thegraph.com/api/${THEGRAPH_API_KEY}/subgraphs/id/CCFSaj7uS128wazXMdxdnbGA3YQnND9yBdHjPtvH7Bc7`,
            }
        }
    }
}

const PAIR_CREATED_ABI_TYPES =  [
    "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline)",
    "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)",
    "function migrate(address token, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline)"
];
const POOL_CREATED_ABI_TYPES = [
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
    "event PoolCreated(address indexed token0, address indexed token1, uint24 fee, int24 tickSpacing, address pool)"
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

async function fetchLogs(provider, tokenAddress, factoryAddress, topic, decoder, abiTypes) {
    const filter0 = {
        address: factoryAddress,
        topics: [topic, ethers.zeroPadValue(tokenAddress, 32)],
        fromBlock: 0,
        toBlock: 'latest'
    };
    const logs0 = await provider.getLogs(filter0);
    const filter1 = {
        address: factoryAddress,
        topics: [topic, null, ethers.zeroPadValue(tokenAddress, 32)],
        fromBlock: 0,
        toBlock: 'latest'
    };
    const logs1 = await provider.getLogs(filter1);
    const logs = [...logs0, ...logs1]

    const results = [];
    for (const log of logs) {
        const parsedLog = decoder(log.data);
        const token0 = ethers.getAddress('0x' + log.topics[1].slice(26));
        const token1 = ethers.getAddress('0x' + log.topics[2].slice(26));
        let feePercentage = 0.3
        if (log.topics[3]) {
            const feeDecimalValue = parseInt(log.topics[3], 16);
            feePercentage = feeDecimalValue / 10000;
        }
        const txHash = log.transactionHash;
        const eventBlock = log.blockNumber;
        const transaction = await provider.getTransaction(txHash);
        const creator = transaction.from;
        const block = await provider.getBlock(transaction.blockNumber);
        const timestamp = block.timestamp;

        const iface = new ethers.Interface(abiTypes);
        const data = transaction.data;
        const dataDecoded = iface.parseTransaction({ data });

        const transactionInputDataMap = {}
        let transactionFunction = null

        if (dataDecoded?.fragment?.inputs) {
            const dataParamNames = dataDecoded.fragment.inputs.map(input => input.name);
            const dataParamValues = dataDecoded.args;
        
            dataParamNames.forEach((name, index) => {
                transactionInputDataMap[`input-${name}`] = dataParamValues[index]
            });

            transactionFunction = dataDecoded.name
        }

        results.push({
            token0,
            token1,
            feePercentage,
            parsedLog,
            txHash,
            eventBlock,
            creator,
            timestamp,
            ...transactionInputDataMap,
            transactionFunction,
        });
    }

    return results;
}

async function handleLogs(logs, network, version, tokenAddress, provider, exchange) {
    const logData = [];
    const tokenSymbol = await getTokenSymbol(provider, tokenAddress);

    for (const log of logs) {
        const { token0, token1, feePercentage, parsedLog, txHash, eventBlock, creator, timestamp, transactionFunction, ...data } = log;
        
        const token0Symbol = await getTokenSymbol(provider, token0);
        const token1Symbol = await getTokenSymbol(provider, token1);

        let logInfo = {
            network,
            version,
            feePercentage,
            token0,
            token0Symbol,
            token1,
            token1Symbol,
            eventBlock,
            creator,
            timestamp,
            timestampString: new Date(timestamp*1000).toISOString(),
            txHash,
            transactionFunction,
        };

        if (version === 'v2') {
            logInfo.pairAddress = parsedLog[0];

            const [uniswapV2Mint] = await getUniswapV2Mints(network, exchange, logInfo.pairAddress)
            const firstUniswapV2PairDayData = await getUniswapV2PairDayData(network, exchange, logInfo.pairAddress, 'FIRST')
            logInfo.firstPrice = uniswapV2Mint?.amount0 ? uniswapV2Mint?.amount1/uniswapV2Mint?.amount0 : 0
            logInfo.firstReserve0 = uniswapV2Mint?.amount0 || 0
            logInfo.firstReserve1 = uniswapV2Mint?.amount1 || 0
            logInfo.firstReserveProvider = uniswapV2Mint?.from || ''
            logInfo.firstReserveUSD = uniswapV2Mint?.amountUSD || 0
            logInfo.firstDayVolumeToken0 = firstUniswapV2PairDayData.dailyVolumeToken0
            logInfo.firstDayVolumeToken1 = firstUniswapV2PairDayData.dailyVolumeToken1
            logInfo.firstDayVolumeUSD = firstUniswapV2PairDayData.dailyVolumeUSD
            
            const latestUniswapV2tData = await getUniswapV2PairDayData(network, exchange, logInfo.pairAddress, 'LATEST')
            logInfo.latestPrice = latestUniswapV2tData.price
            logInfo.latestReserve0 = latestUniswapV2tData.reserve0
            logInfo.latestReserve1 = latestUniswapV2tData.reserve1
            logInfo.latestReserveUSD = latestUniswapV2tData.reserveUSD
            logInfo.latestDayVolumeToken0 = latestUniswapV2tData.dailyVolumeToken0
            logInfo.latestDayVolumeToken1 = latestUniswapV2tData.dailyVolumeToken1
            logInfo.latestDayVolumeUSD = latestUniswapV2tData.dailyVolumeUSD

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
            
        } else if (version === 'v3') {
            // logInfo.tickSpacing = parsedLog[0];
            logInfo.poolAddress = parsedLog.length >= 2 ? parsedLog[1] : parsedLog[0];

            const [uniswapV3Mint] = await getUniswapV3Mints(network, exchange, logInfo.poolAddress)
            const firstUniswapV3Data = await getUniswapV3PoolDayDatas(network, exchange, logInfo.poolAddress, 'FIRST')
            logInfo.firstPrice = firstUniswapV3Data.price
            logInfo.firstReserve0 = uniswapV3Mint?.amount0
            logInfo.firstReserve1 = uniswapV3Mint?.amount1
            logInfo.firstReserveProvider = uniswapV3Mint?.from || ''
            logInfo.firstReserveUSD = uniswapV3Mint?.amountUSD
            logInfo.firstDayVolumeToken0 = firstUniswapV3Data.volumeToken0
            logInfo.firstDayVolumeToken1 = firstUniswapV3Data.volumeToken1
            logInfo.firstDayVolumeUSD = firstUniswapV3Data.volumeUSD
            
            const latestUniswapV3Data = await getUniswapV3PoolDayDatas(network, exchange, logInfo.poolAddress, 'LATEST')
            logInfo.latestPrice = latestUniswapV3Data.price
            logInfo.latestReserve0 = latestUniswapV3Data.totalValueLockedToken0
            logInfo.latestReserve1 = latestUniswapV3Data.totalValueLockedToken1
            logInfo.latestReserveUSD = latestUniswapV3Data.totalValueLockedUSD
            logInfo.latestDayVolumeToken0 = latestUniswapV3Data.volumeToken0
            logInfo.latestDayVolumeToken1 = latestUniswapV3Data.volumeToken1
            logInfo.latestDayVolumeUSD = latestUniswapV3Data.volumeUSD

            // logInfo.eventName = mintEventData.eventName
            // logInfo.sender = mintEventData.sender
            // logInfo.owner = mintEventData.owner
            // logInfo.tickLower = mintEventData.tickLower
            // logInfo.tickUpper = mintEventData.tickUpper
            // logInfo.amount = mintEventData.amount
            // logInfo.amount0 = mintEventData.amount0
            // logInfo.amount1 = mintEventData.amount1
        }

        logData.push(logInfo);

    }

    // Generate directory path and filename with token symbol
    const dirPath = path.join('results', tokenSymbol, network, tokenAddress, exchange);
    const filename = `${version}.json`;
    const filePath = path.join(dirPath, filename);

    writeToFile(logData, filePath, true);

    if (logData.length) {

        const logData2 = Object.keys(logData[0]).join(',') + '\n' + logData.map((logDataContent) => Object.values(logDataContent).join(',')).join('\n')

        // const colNames = [
        //     'network',
        //     'version',
        //     'token0Symbol',
        //     'token1Symbol',
        //     'feePercentage',
        //     'timestamp',
        //     'poolAddress',
        //     'firstPrice',
        //     'firstDayVolumeToken0',
        //     'firstDayVolumeToken1',
        //     // 'firstDayVolumeUSD',
        //     'firstReserve0',
        //     'firstReserve1',
        //     'latestPrice',
        //     'latestDayVolumeToken0',
        //     'latestDayVolumeToken1',
        //     // 'latestDayVolumeUSD'
        //   ]
        // let logData2 = colNames.join(',') + '\n'
        // logData2 += logData.map(logDataContent => {
        //     const logDataContentResult = {}
        //     for (const colName of colNames) {
        //       logDataContentResult[colName] = logDataContent[colName]
        //     }
        //     return Object.values(logDataContentResult).join(',')
        //   }).join('\n')

        const filename2 = `${version}.csv`;
        const filePath2 = path.join(dirPath, filename2);
        writeToFile(logData2, filePath2);
    }
}

function writeToFile(data, filePath, convertToString) {
    if (!convertToString) {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
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

/**
 * @param {*} network 
 * @param {*} pairAddress 
 * @param {*} type 'FIRST' | 'LATEST'
 * @returns 
 */
async function getUniswapV2PairDayData(network, exchange, pairAddress, type) {
    const endpoint = dataMap[exchange].v2[network].theGraphEndpoint
    let orderDirection = 'asc'
    if (type === 'LATEST') {
        orderDirection = 'desc'
    }
    
      const query = `
      {
        pairDayDatas(
          first: 1
          orderBy: date
          orderDirection: ${orderDirection}
          where: {pairAddress: "${pairAddress.toLowerCase()}"}
        ) {
          id
          dailyVolumeToken0
          dailyVolumeToken1
          dailyVolumeUSD
          date
          reserve0
          reserve1
          reserveUSD
          token0 {
            symbol
          }
          token1 {
            symbol
          }
        }
      }
      `;
  
      try {
        const data = await request(endpoint, query);
        if (data?.pairDayDatas.length) {
          const price = data.pairDayDatas[0].reserve1 / data.pairDayDatas[0].reserve0
          return {
            price,
            reserve0: data.pairDayDatas[0].reserve0,
            reserve1: data.pairDayDatas[0].reserve1,
            reserveUSD: data.pairDayDatas[0].reserveUSD,
            dailyVolumeToken0: data.pairDayDatas[0].dailyVolumeToken0,
            dailyVolumeToken1: data.pairDayDatas[0].dailyVolumeToken1,
            dailyVolumeUSD: data.pairDayDatas[0].dailyVolumeUSD,
          }
        }
        throw new Error(`getUniswapV2PairDayData missing data, pairAddress: ${pairAddress}`) 
      } catch (error) {
        console.error('getUniswapV2PairDayData, error:', error);
        throw error
      }
}

async function getUniswapV2Mints(network, exchange, pairAddress) {
    console.log(`getUniswapV2Mints, pairAddress: ${pairAddress}`)
    const endpoint = dataMap[exchange].v2[network].theGraphEndpoint
  
      const query = `
  {
    mints(
      first: 1
      where: { pair: "${pairAddress.toLowerCase()}" }
      orderBy: timestamp
      orderDirection: asc
    ) {
      id
      pair {
        token0 {
          symbol
          id
        }
        token1 {
          symbol
          id
        }
      }
      to
      liquidity
      amount0
      amount1
      amountUSD
      timestamp
      transaction {
        id
      }
    }
  }
  
      `;
  
    const data = await request(endpoint, query);
    
    const results = data.mints.map(mint => {
      return {
        timestamp: mint.timestamp,
        timestampString: new Date(mint.timestamp*1000).toISOString(),
        from: mint.to,
        token0: mint.pair.token0.symbol,
        token1: mint.pair.token1.symbol,
        amount0: mint.amount0,
        amount1: mint.amount1,
        amountUSD: mint.amountUSD,
      }
    })
  
    return results
  }

  async function getUniswapV3Mints(network, exchange, poolAddress) {
    console.log(`getUniswapV3Mints, poolAddress: ${poolAddress}, poolAddress.toLowerCase(): ${poolAddress.toLowerCase()}`)
    const endpoint = dataMap[exchange].v3[network].theGraphEndpoint;
  
      const query = `
  {
  mints(
    first: 1,
    orderBy: timestamp,
    orderDirection: asc,
    where: { 
      pool: "${poolAddress.toLowerCase()}"
    }
  ) {
    id
    timestamp
    origin
    amount
    amount0
    amount1
    amountUSD
    tickLower
    tickUpper
    pool {
      id
      token0 {
        symbol
        id
      }
      token1 {
        symbol
        id
      }
    }
    transaction {
      id
      timestamp
    }
  }
}
      `;
  
    const data = await request(endpoint, query);
    
    const results = data.mints.map(mint => {
      return {
        timestamp: mint.timestamp,
        timestampString: new Date(mint.timestamp*1000).toISOString(),
        from: mint.origin,
        token0: mint.pool.token0.symbol,
        token1: mint.pool.token1.symbol,
        amount0: mint.amount0,
        amount1: mint.amount1,
        amountUSD: mint.amountUSD,
      }
    })
  
    return results
  }


/**
 * 
 * @param {*} poolAddress 
 * @param {*} type 'FIRST' | 'LATEST'
 * @returns 
 */
async function getUniswapV3PoolDayDatas(network, exchange, poolAddress, type) {
    console.log(`getUniswapV3PoolDayDatas, poolAddress: ${poolAddress}`)
    const endpoint = dataMap[exchange].v3[network].theGraphEndpoint
    let orderDirection = 'asc'
    if (type === 'LATEST') {
        orderDirection = 'desc'
    }
    
      const query = `
      {
        poolDayDatas(
            first: 2,
            orderBy: date,
            orderDirection: ${orderDirection},
            where: {
                pool: "${poolAddress.toLowerCase()}"
            }
        ) {
            date
            volumeUSD
            volumeToken0
            volumeToken1
            feesUSD
            open
            high
            low
            close
            pool {
                token0 {
                    symbol
                    volume
                    volumeUSD
                }
                token1 {
                    symbol
                    volume
                    volumeUSD
                }
                token0Price
                token1Price
                volumeUSD
                totalValueLockedToken0
                totalValueLockedToken1
                totalValueLockedUSD
            }
            liquidity
            sqrtPrice
        }
    }
      `;
  
      try {
        const data = await request(endpoint, query);
        if (data?.poolDayDatas.length) {
        //   let price = data.poolDayDatas[0].close
        // //   if (orderDirection === 'asc') {
        // //     price = data.poolDayDatas[1].open
        // //   }
          return {
            price: data.poolDayDatas[0].pool.token1Price,
            totalValueLockedToken0: data.poolDayDatas[0].pool.totalValueLockedToken0,
            totalValueLockedToken1: data.poolDayDatas[0].pool.totalValueLockedToken1,
            totalValueLockedUSD: data.poolDayDatas[0].pool.totalValueLockedUSD,
            volumeToken0: data.poolDayDatas[0].volumeToken0,
            volumeToken1: data.poolDayDatas[0].volumeToken1,
            volumeUSD: data.poolDayDatas[0].volumeUSD,
          }
        }
        console.warn(`getUniswapV3PoolDayDatas missing data, poolAddress: ${poolAddress}`)
        return {
            price: 0,
            totalValueLockedToken0: 0,
            totalValueLockedToken1: 0,
            volumeToken0: 0,
            volumeToken1: 0,
            volumeUSD: 0,
          }
      } catch (error) {
        console.error('getUniswapV3PoolDayDatas error:', error);
        throw error
      }
}

async function getUniswapV3MintEventData(provider, poolAddress) {
    try {
        const contract = new ethers.Contract(poolAddress, poolABI, provider);

        // 設定查詢過濾器 (從區塊0到最新區塊)
        const filter = {
            address: poolAddress,
            fromBlock: 0,
            toBlock: 'latest',
            topics: [UNISWAP_POOL_MINT_TOPIC]
        };
  
        // 查詢所有事件日誌
        const logs = await provider.getLogs(filter);
  
        const results = []
        // 解析每個事件日誌
        for (const log of logs) {
            try {
                const parsedLog = contract.interface.parseLog(log);
                // const eventName = parsedLog.name;
                // const sender = parsedLog.args[0]
                // const owner = parsedLog.args[1]
                // const tickLower = parsedLog.args[2].toString()
                // const tickUpper = parsedLog.args[3].toString()
                // const amount = parsedLog.args[4].toString()
                // const amount0 = parsedLog.args[5].toString()
                // const amount1 = parsedLog.args[6].toString()

                results.push({
                    eventName: parsedLog.name,
                    sender: parsedLog.args[0],
                    owner: parsedLog.args[1],
                    tickLower: parsedLog.args[2].toString(),
                    tickUpper: parsedLog.args[3].toString(),
                    amount: parsedLog.args[4].toString(),
                    amount0: parsedLog.args[5].toString(),
                    amount1: parsedLog.args[6].toString(),
                })
  
            } catch (error) {
                console.error('getUniswapV3MintEventData parseLog error:', error);
            }
        }

        return results
    } catch (error) {
        console.error('getUniswapV3MintEventData error:', error);
    }
}

async function main(networkInput, tokenAddress, exchange) {
    console.log(`main, networkInput: ${networkInput}, tokenAddress: ${tokenAddress}, exchange: ${exchange}`)
    const provider = new ethers.AlchemyProvider(networkInput, ALCHEMY_API_KEY);
    const v2FactoryAddress = dataMap[exchange]?.v2?.[networkInput]?.factoryAddress
    const v3FactoryAddress = dataMap[exchange]?.v3?.[networkInput]?.factoryAddress

    console.log(`main, v2FactoryAddress: ${v2FactoryAddress}, v3FactoryAddress: ${v3FactoryAddress}`)

    if (v2FactoryAddress)  {
        const logsV2 = await fetchLogs(
            provider,
            tokenAddress,
            v2FactoryAddress,
            dataMap[exchange]?.v2?.factoryPCreatedTopic,
            dataMap[exchange]?.v2?.decoder,
            PAIR_CREATED_ABI_TYPES,
        );
        handleLogs(logsV2, networkInput, 'v2', tokenAddress, provider, exchange);
    }

    if (v3FactoryAddress) {
        const logsV3 = await fetchLogs(
            provider,
            tokenAddress,
            v3FactoryAddress,
            dataMap[exchange]?.v3?.factoryPCreatedTopic,
            dataMap[exchange]?.v3?.decoder,
            POOL_CREATED_ABI_TYPES,
        );
    
        handleLogs(logsV3, networkInput, 'v3', tokenAddress, provider, exchange)
    }
}

const args = process.argv.slice(2);
const networkInput = args[0] || 'mainnet';
const tokenAddress = args[1] || '0x0f5d2fb29fb7d3cfee444a200298f468908cc942';
const exchange = args[2] || 'uniswap';

// main(networkInput, tokenAddress, exchange).catch(console.error);

// GHST
main('mainnet', '0x3F382DbD960E3a9bbCeaE22651E88158d2791550', 'uniswap').catch(console.error);
// main('base', '0xcd2f22236dd9dfe2356d7c543161d4d260fd9bcb', 'uniswap').catch(console.error);
main('matic', '0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7', 'quickswap').catch(console.error);

// MANA
main('mainnet', '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942', 'uniswap').catch(console.error);

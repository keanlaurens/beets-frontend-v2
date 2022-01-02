import { configService as _configService } from '@/services/config/config.service';
import axios from 'axios';
import {
  CreateLgeTypes,
  GqlBalancerPoolSnapshot,
  GqlBeetsFarm,
  GqlBeetsFarmUser,
  GqlBeetsProtocolData,
  GqlHistoricalTokenPrice,
  GqlLge,
  GqlLgeCreateInput,
  GqlTokenPrice,
  GqlUserPortfolioData,
  GqlUserTokenData,
  UserPortfolio,
  UserPortfolioData,
  UserTokenData
} from './beethovenx-types';
import { getAddress, isAddress } from '@ethersproject/address';
import { keyBy } from 'lodash';
import { Web3Provider } from '@ethersproject/providers';
import { jsonToGraphQLQuery } from 'json-to-graphql-query';

export type Price = { [fiat: string]: number };
export type TokenPrices = { [address: string]: Price };
export type HistoricalPrices = { [timestamp: string]: number[] };

export interface BeethovenxConfig {
  incentivizedPools: string[];
  pausedPools: string[];
  blacklistedPools: string[];
  featuredPools: string[];
}

export default class BeethovenxService {
  private readonly url: string;

  constructor(private readonly configService = _configService) {
    this.url =
      configService.env.BACKEND_URL || configService.network.backendUrl;
  }

  public async getUserPortfolio(address: string): Promise<UserPortfolio> {
    const query = `
      query {
        portfolio: portfolioGetUserPortfolio {
          ...GqlUserPortfolioData
        }
        history: portfolioGetUserPortfolioHistory {
          ...GqlUserPortfolioData
        }
      }
      
      ${this.userProfileDataFragment}
    `;

    const response = await this.get<{
      portfolio: GqlUserPortfolioData;
      history: GqlUserPortfolioData[];
    }>(query, address);

    return {
      portfolio: this.mapPortfolioData(response.portfolio),
      history: response.history.map(item => this.mapPortfolioData(item))
    };
  }

  public async getTokenPrices(): Promise<TokenPrices> {
    const query = `
      query {
        tokenPrices: tokenPriceGetCurrentPrices {
          price
          address
        }
      }
    `;

    const response = await this.get<{
      tokenPrices: GqlTokenPrice[];
    }>(query);

    if (!response) {
      return {};
    }

    const result: TokenPrices = {};

    for (const tokenPrice of response.tokenPrices) {
      if (isAddress(tokenPrice.address)) {
        result[getAddress(tokenPrice.address)] = { usd: tokenPrice.price };
      }
    }

    return result;
  }

  public async getHistoricalTokenPrices(
    addresses: string[]
  ): Promise<HistoricalPrices> {
    const lowerCaseAddresses = addresses.map(address => address.toLowerCase());

    const query = `
      query {
        tokenPrices: tokenPriceGetHistoricalPrices(addresses: ["${lowerCaseAddresses.join(
          '","'
        )}"]) {
          address
          prices {
            timestamp
            price
          }
        }
      }
    `;

    const { tokenPrices } = await this.get<{
      tokenPrices: GqlHistoricalTokenPrice[];
    }>(query);
    const timestamps =
      tokenPrices[0]?.prices.map(price => price.timestamp) || [];

    const result: HistoricalPrices = {};
    const tokenPricesMap = keyBy(tokenPrices, 'address');

    for (const timestamp of timestamps) {
      result[timestamp] = lowerCaseAddresses.map(address => {
        const entry = tokenPricesMap[address].prices.find(
          price => price.timestamp === timestamp
        );

        return entry?.price || 0;
      });
    }

    return result;
  }

  public async getBeethovenxConfig(): Promise<BeethovenxConfig> {
    const { data } = await axios.get<{ result: BeethovenxConfig }>(
      this.configService.network.configSanityUrl
    );

    return data.result;
  }

  public async createLge(
    web3: Web3Provider,
    input: GqlLgeCreateInput,
    account: string
  ): Promise<{ id: string }> {
    const signature = await web3.getSigner()._signTypedData(
      {
        name: 'beethovenx',
        version: '1',
        chainId: this.configService.network.chainId
      },
      CreateLgeTypes,
      input
    );

    const query = jsonToGraphQLQuery({
      mutation: {
        lgeCreate: {
          __args: { signature, lge: input },
          id: true,
          address: true,
          name: true
        }
      }
    });

    return this.get<{ id: string }>(query, account);
  }

  public async getLge(id: string): Promise<GqlLge> {
    const query = jsonToGraphQLQuery({
      query: {
        lge: {
          __args: { id },
          ...this.lgeQueryFields
        }
      }
    });

    const response = await this.get<{ lge: GqlLge }>(query);

    return response.lge;
  }

  public async getLges(): Promise<GqlLge[]> {
    const query = jsonToGraphQLQuery({
      query: { lges: this.lgeQueryFields }
    });

    const response = await this.get<{ lges: GqlLge[] }>(query);

    return response.lges;
  }

  public async isAddressMultisigWallet(address: string): Promise<boolean> {
    const query = jsonToGraphQLQuery({
      query: { gnosisIsUserMultisigWallet: true }
    });

    const response = await this.get<{ gnosisIsUserMultisigWallet: boolean }>(
      query,
      address
    );

    return response.gnosisIsUserMultisigWallet;
  }

  private async get<T>(query: string, address?: string): Promise<T> {
    try {
      const {
        data: { data }
      } = await axios.post(
        this.url,
        { query },
        {
          headers: {
            'Content-Type': 'application/json',
            AccountAddress: address
          }
        }
      );
      return data;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  public async getFbeetsApr(): Promise<number> {
    const query = jsonToGraphQLQuery({
      query: {
        fbeetsGetApr: {
          apr: true
        }
      }
    });

    const { fbeetsGetApr } = await this.get<{ fbeetsGetApr: { apr: number } }>(
      query
    );

    return fbeetsGetApr.apr;
  }

  public async getProtocolData(): Promise<GqlBeetsProtocolData> {
    const query = jsonToGraphQLQuery({
      query: {
        beetsGetProtocolData: {
          marketCap: true,
          beetsPrice: true,
          totalSwapFee: true,
          totalLiquidity: true,
          totalSwapVolume: true,
          poolCount: true,
          circulatingSupply: true
        }
      }
    });

    const { beetsGetProtocolData } = await this.get<{
      beetsGetProtocolData: GqlBeetsProtocolData;
    }>(query);

    return beetsGetProtocolData;
  }

  public async getPoolSnapshots(
    poolId: string
  ): Promise<GqlBalancerPoolSnapshot[]> {
    const query = jsonToGraphQLQuery({
      query: {
        poolSnapshots: {
          __args: { poolId },
          id: true,
          poolId: true,
          swapFees24h: true,
          swapVolume24h: true,
          liquidityChange24h: true,
          totalShares: true,
          totalSwapFee: true,
          totalLiquidity: true,
          totalSwapVolume: true,
          timestamp: true,
          tokens: {
            address: true,
            balance: true
          }
        }
      }
    });

    const { poolSnapshots } = await this.get<{
      poolSnapshots: GqlBalancerPoolSnapshot[];
    }>(query);

    return poolSnapshots;
  }

  public async getAverageBlockTime(): Promise<number> {
    const query = jsonToGraphQLQuery({
      query: { blocksGetAverageBlockTime: true }
    });

    const { blocksGetAverageBlockTime } = await this.get<{
      blocksGetAverageBlockTime: number;
    }>(query);

    return blocksGetAverageBlockTime;
  }

  public async getBeetsFarms(): Promise<GqlBeetsFarm[]> {
    const query = jsonToGraphQLQuery({
      query: {
        beetsGetBeetsFarms: {
          id: true,
          pair: true,
          allocPoint: true,
          slpBalance: true,
          masterChef: {
            id: true,
            totalAllocPoint: true,
            beetsPerBlock: true
          },
          rewarder: {
            id: true,
            rewardToken: true,
            rewardPerSecond: true
          }
        }
      }
    });

    const { beetsGetBeetsFarms } = await this.get<{
      beetsGetBeetsFarms: GqlBeetsFarm[];
    }>(query);

    return beetsGetBeetsFarms;
  }

  public async getUserDataForFarm(
    farmId: string,
    userAddress: string
  ): Promise<GqlBeetsFarmUser> {
    const query = jsonToGraphQLQuery({
      query: {
        beetsGetUserDataForFarm: {
          __args: { farmId },
          id: true,
          address: true,
          amount: true,
          beetsHarvested: true,
          farmId: true,
          rewardDebt: true,
          timestamp: true
        }
      }
    });

    const { beetsGetUserDataForFarm } = await this.get<{
      beetsGetUserDataForFarm: GqlBeetsFarmUser | null;
    }>(query, userAddress);

    return beetsGetUserDataForFarm
      ? beetsGetUserDataForFarm
      : {
          id: '',
          address: '',
          amount: '0',
          beetsHarvested: '0',
          rewardDebt: '0',
          timestamp: '',
          farmId
        };
  }

  public async getUserDataForAllFarms(
    userAddress: string
  ): Promise<GqlBeetsFarmUser[]> {
    const query = jsonToGraphQLQuery({
      query: {
        beetsGetUserDataForAllFarms: {
          id: true,
          address: true,
          amount: true,
          beetsHarvested: true,
          farmId: true,
          rewardDebt: true,
          timestamp: true
        }
      }
    });

    const { beetsGetUserDataForAllFarms } = await this.get<{
      beetsGetUserDataForAllFarms: GqlBeetsFarmUser[];
    }>(query, userAddress);

    return beetsGetUserDataForAllFarms;
  }

  private get userProfileDataFragment() {
    return `
      fragment GqlUserPortfolioData on GqlUserPortfolioData {
        timestamp
        totalSwapFees
        totalSwapVolume
        totalValue
        myFees
        pools {
          id
          myFees
          name
          percentOfPortfolio
          percentShare
          poolAddress
          poolId
          priceChange
          priceChangePercent
          pricePerShare
          shares
          swapFees
          swapVolume
          tokens {
            address
            balance
            id
            name
            percentOfPortfolio
            pricePerToken
            symbol
            totalValue
          }
          totalValue
        }
        tokens {
          address
          balance
          id
          name
          percentOfPortfolio
          pricePerToken
          symbol
          totalValue
        }
      }
    `;
  }

  private get lgeQueryFields() {
    return {
      address: true,
      collateralAmount: true,
      collateralEndWeight: true,
      collateralStartWeight: true,
      collateralTokenAddress: true,
      description: true,
      discordUrl: true,
      endDate: true,
      id: true,
      mediumUrl: true,
      name: true,
      startDate: true,
      swapFeePercentage: true,
      telegramUrl: true,
      tokenAmount: true,
      tokenContractAddress: true,
      tokenEndWeight: true,
      tokenIconUrl: true,
      tokenStartWeight: true,
      twitterUrl: true,
      websiteUrl: true,
      bannerImageUrl: true,
      adminAddress: true,
      adminIsMultisig: true
    };
  }

  public mapPortfolioData(data: GqlUserPortfolioData): UserPortfolioData {
    return {
      ...data,
      totalValue: parseFloat(data.totalValue),
      totalSwapFees: parseFloat(data.totalSwapFees),
      totalSwapVolume: parseFloat(data.totalSwapVolume),
      myFees: parseFloat(data.myFees),
      pools: data.pools.map(pool => ({
        ...pool,
        totalValue: parseFloat(pool.totalValue),
        swapFees: parseFloat(pool.swapFees),
        swapVolume: parseFloat(pool.swapVolume),
        myFees: parseFloat(pool.myFees),
        priceChange: parseFloat(pool.priceChange),
        pricePerShare: parseFloat(pool.pricePerShare),
        shares: parseFloat(pool.shares),
        tokens: pool.tokens.map(token => this.mapUserTokenData(token))
      })),
      tokens: data.tokens.map(token => this.mapUserTokenData(token))
    };
  }

  private mapUserTokenData(token: GqlUserTokenData): UserTokenData {
    return {
      ...token,
      balance: parseFloat(token.balance),
      pricePerToken: parseFloat(token.pricePerToken),
      totalValue: parseFloat(token.totalValue)
    };
  }
}

export const beethovenxService = new BeethovenxService();

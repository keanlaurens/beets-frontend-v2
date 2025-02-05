import { computed, reactive } from 'vue';
import { useQuery } from 'vue-query';
import { UseQueryOptions } from 'react-query/types';
import { flatten, keyBy } from 'lodash';
import { bnum, forChange } from '@/lib/utils';
import { formatUnits } from 'ethers/lib/utils';
import QUERY_KEYS from '@/constants/queryKeys';
import { balancerSubgraphService } from '@/services/balancer/subgraph/balancer-subgraph.service';
import {
  DecoratedPoolWithShares,
  LinearPool,
  Pool
} from '@/services/balancer/subgraph/types';
import { balancerContractsService } from '@/services/balancer/contracts/balancer-contracts.service';
import useWeb3 from '@/services/web3/useWeb3';
import useTokenLists from '../useTokenLists';
import useTokens from '../useTokens';
import useUserSettings from '../useUserSettings';
import useNetwork from '../useNetwork';
import { isStablePhantom, lpTokensFor } from '../usePool';
import { getAddress } from '@ethersproject/address';
import { POOLS } from '@/constants/pools';

type UserPoolsQueryResponse = {
  pools: DecoratedPoolWithShares[];
  totalInvestedAmount: string;
  tokens: string[];
};

export default function useUserPoolsQuery(
  options: UseQueryOptions<UserPoolsQueryResponse> = {}
) {
  /**
   * COMPOSABLES
   */
  const { injectTokens, prices, dynamicDataLoading, getTokens } = useTokens();
  const { loadingTokenLists } = useTokenLists();
  const { account, isWalletReady } = useWeb3();
  const { currency } = useUserSettings();
  const { networkId } = useNetwork();

  /**
   * COMPUTED
   */
  const enabled = computed(
    () =>
      isWalletReady.value && account.value != null && !loadingTokenLists.value
  );

  function removePreMintedBPT(pool: Pool): Pool {
    const poolAddress = balancerSubgraphService.pools.addressFor(pool.id);
    // Remove pre-minted BPT token if exits
    pool.tokensList = pool.tokensList.filter(
      address => address !== poolAddress.toLowerCase()
    );
    return pool;
  }

  /**
   * fetches StablePhantom linear pools and extracts
   * required attributes.
   */
  async function getLinearPoolAttrs(pool: Pool): Promise<Pool> {
    // Fetch linear pools from subgraph
    const pools = await balancerSubgraphService.pools.get();
    const linearPools = pools.filter(
      pool => pool.poolType === 'Linear'
    ) as LinearPool[];
    const linearPoolTokensMap: Pool['linearPoolTokensMap'] = {};

    // Inject main/wrapped tokens into pool schema
    linearPools.forEach(linearPool => {
      if (!pool.wrappedTokens) pool.wrappedTokens = [];

      const index = pool.tokensList.indexOf(linearPool.address.toLowerCase());

      pool.wrappedTokens[index] = getAddress(
        linearPool.tokensList[linearPool.wrappedIndex]
      );

      linearPool.tokens
        .filter(token => token.address !== linearPool.address)
        .forEach(token => {
          const address = getAddress(token.address);

          linearPoolTokensMap[address] = {
            ...token,
            address
          };
        });
    });

    pool.linearPoolTokensMap = linearPoolTokensMap;
    pool.linearPoolToMainTokenMap = linearPools.reduce((map, linearPool) => {
      map[linearPool.address] = linearPool.tokensList[linearPool.mainIndex];
      return map;
    }, {});

    return pool;
  }

  /**
   * QUERY PROPERTIES
   */
  const queryKey = reactive(QUERY_KEYS.Pools.User(networkId, account));

  const queryFn = async () => {
    const poolShares = await balancerSubgraphService.poolShares.get({
      where: {
        userAddress: account.value.toLowerCase()
      }
    });

    const poolSharesIds = poolShares.map(poolShare => poolShare.poolId.id);
    const poolSharesMap = keyBy(poolShares, poolShare => poolShare.poolId.id);

    const pools = await balancerSubgraphService.pools.get();
    const userPools = pools.filter(pool => poolSharesIds.includes(pool.id));

    for (let i = 0; i < pools.length; i++) {
      const isStablePhantomPool = isStablePhantom(pools[i].poolType);

      if (isStablePhantomPool) {
        pools[i] = removePreMintedBPT(pools[i]);
      }

      if (pools[i].linearPools) {
        pools[i] = await getLinearPoolAttrs(pools[i]);
      }
    }

    const tokens = flatten(
      pools.map(pool => {
        return [
          ...pool.tokensList,
          ...lpTokensFor(pool),
          balancerSubgraphService.pools.addressFor(pool.id)
        ];
      })
    );
    await injectTokens(tokens);
    await forChange(dynamicDataLoading, false);

    const decoratedPools = await balancerSubgraphService.pools.decorate(
      userPools
    );

    const poolsWithShares = decoratedPools.map(pool => ({
      ...pool,
      shares: bnum(pool.totalLiquidity)
        .div(pool.totalShares)
        .times(poolSharesMap[pool.id]?.balance ?? 0)
        .toString()
    }));

    const totalInvestedAmount = poolsWithShares
      .map(pool => pool.shares)
      .reduce((totalShares, shares) => totalShares.plus(shares), bnum(0))
      .toString();

    return {
      pools: poolsWithShares,
      tokens,
      totalInvestedAmount
    };
  };

  const queryOptions = reactive({
    enabled,
    ...options
  });

  return useQuery<UserPoolsQueryResponse>(queryKey, queryFn, queryOptions);
}

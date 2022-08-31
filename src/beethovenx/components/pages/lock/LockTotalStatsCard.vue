<template>
  <BalLoadingBlock v-if="lockDataLoading" class="h-64" />
  <BalCard v-else growContent>
    <div class="flex flex-col w-full h-full bg-transparent">
      <div class="pb-3 border-b">
        <div class="text-sm text-gray-500 font-medium mb-2">
          APR
        </div>
        <div class="text-xl font-medium truncate flex items-center">
          {{ fNum(totalApr, 'percent') }}
          <LockAprTooltip
            :swap-apr="swapApr"
            :total-rewards-apr="totalRewardsApr"
            :fbeets-apr="fbeetsApr"
          />
        </div>
      </div>
      <div class="pt-3 pb-3 border-b">
        <div class="text-sm text-gray-500 font-medium mb-2">
          Total Locked fBEETS
        </div>
        <div class="text-xl font-medium truncate flex items-center">
          {{ fNum(totalLockedAmount) }}&nbsp;
          <span class="text-sm text-gray-500 font-medium mt-1 text-left">
            ({{ fNum(totalLockedPercentage, 'percent') }} of total supply)
          </span>
        </div>
      </div>
      <div class="pt-3">
        <div class="text-sm text-gray-500 font-medium mb-2">
          Next epoch starts on
        </div>
        <div class="text-md font-medium truncate flex items-center">
          {{ nextEpochStartDate }}
        </div>
      </div>
    </div>
  </BalCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import useNumbers from '@/composables/useNumbers';
import { useLock } from '@/beethovenx/composables/lock/useLock';
import LockAprTooltip from '@/beethovenx/components/pages/lock/LockAprTooltip.vue';
import { format } from 'date-fns';
import { useFreshBeets } from '@/beethovenx/composables/stake/useFreshBeets';
import { sum } from 'lodash';

export default defineComponent({
  name: 'LockMyStatsCard',

  components: { LockAprTooltip },

  setup() {
    const { fNum } = useNumbers();
    const {
      lockDataLoading,
      totalLockedAmount,
      totalLockedUsd,
      totalLockedPercentage,
      totalRewardsApr
    } = useLock();
    const { swapApr } = useFreshBeets();

    function nextDay(d, dow: number) {
      const addDays = (dow + (7 - d.getDay())) % 7 || 7;
      d.setDate(d.getDate() + addDays);
      d.setUTCHours(0, 0, 0);
      return format(d, 'PP hh:mm a');
    }

    const nextEpochStartDate = computed(() => {
      const today = new Date();
      return nextDay(today, 4);
    });

    const totalApr = computed(() =>
      sum([totalRewardsApr.value, swapApr.value])
    );

    return {
      fNum,
      lockDataLoading,
      totalLockedAmount,
      totalLockedUsd,
      totalLockedPercentage,
      totalRewardsApr,
      nextEpochStartDate,
      swapApr,
      totalApr
    };
  }
});
</script>

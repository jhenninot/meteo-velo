<script setup>
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
} from 'chart.js'
import { Line } from 'vue-chartjs'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
)

const props = defineProps({
  elevationData: {
    type: Object,
    required: true
  },
  theme: {
    type: String,
    default: 'light'
  }
})

const chartData = computed(() => {
  const dataPoints = props.elevationData.elevations
  const labels = props.elevationData.distances.map(d => `${d.toFixed(1)} km`)
  
  const isDark = props.theme === 'dark'
  const lineColor = '#FC4C02' // Strava orange brand color
  const fillGradient = isDark ? 'rgba(252, 76, 2, 0.18)' : 'rgba(252, 76, 2, 0.08)'

  return {
    labels,
    datasets: [
      {
        label: 'Altitude',
        data: dataPoints,
        borderColor: lineColor,
        backgroundColor: fillGradient,
        fill: true,
        tension: 0.2,
        borderWidth: 2,
        pointRadius: 0, // clean curve without point markers
        pointHoverRadius: 4,
        pointHitRadius: 8,
        pointBackgroundColor: lineColor
      }
    ]
  }
})

const chartOptions = computed(() => {
  const isDark = props.theme === 'dark'
  const textColor = isDark ? '#b0b8c4' : '#666'
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: isDark ? '#252a32' : '#ffffff',
        titleColor: isDark ? '#e8eaed' : '#333333',
        bodyColor: isDark ? '#b0b8c4' : '#666666',
        borderColor: isDark ? '#3d4450' : '#dddddd',
        borderWidth: 1,
        callbacks: {
          label: function(context) {
            return `Altitude : ${Math.round(context.parsed.y)} m`
          }
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: textColor,
          maxTicksLimit: 8,
          font: {
            size: 10,
            weight: '600'
          }
        },
        grid: {
          color: gridColor,
          display: true,
          drawOnChartArea: true
        }
      },
      y: {
        type: 'linear',
        min: 0,
        ticks: {
          color: textColor,
          callback: function(value) {
            return `${value} m`
          },
          font: {
            size: 10,
            weight: '600'
          }
        },
        grid: {
          color: gridColor
        }
      }
    }
  }
})
</script>

<template>
  <div class="elevation-chart-wrapper">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.elevation-chart-wrapper {
  width: 100%;
  height: 100%;
}
</style>

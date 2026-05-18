<script setup>
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar } from 'vue-chartjs'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
)

const props = defineProps({
  hourlyData: {
    type: Array,
    required: true
  },
  theme: {
    type: String,
    default: 'light'
  }
})

const createWindArrow = (dir, color) => {
  const canvas = document.createElement('canvas')
  canvas.width = 20
  canvas.height = 20
  const ctx = canvas.getContext('2d')
  
  ctx.translate(10, 10)
  ctx.rotate((dir * Math.PI) / 180)
  
  ctx.beginPath()
  ctx.moveTo(0, -7)
  ctx.lineTo(5, 5)
  ctx.lineTo(0, 2)
  ctx.lineTo(-5, 5)
  ctx.closePath()
  
  ctx.fillStyle = color
  ctx.fill()
  
  return canvas
}

const chartData = computed(() => {
  const labels = props.hourlyData.map(d => [`${d.hour}h`, `${d.rain}%`])
  const precip = props.hourlyData.map(d => d.precip)
  const wind = props.hourlyData.map(d => d.wind)
  
  const isDark = props.theme === 'dark'
  const arrowColor = isDark ? '#e8eaed' : '#555'
  const pointStyles = props.hourlyData.map(d => createWindArrow(d.dir, arrowColor))

  return {
    labels,
    datasets: [
      {
        type: 'line',
        label: 'Vent',
        data: wind,
        borderColor: '#9e9e9e',
        backgroundColor: '#9e9e9e',
        yAxisID: 'y1',
        tension: 0.3,
        borderWidth: 2,
        showLine: false,
        pointStyle: pointStyles,
        order: 1
      },
      {
        type: 'bar',
        label: 'Pluie',
        data: precip,
        backgroundColor: '#2196f3',
        yAxisID: 'y',
        order: 2,
        barPercentage: 0.6
      }
    ]
  }
})

const chartOptions = computed(() => {
  const isDark = props.theme === 'dark'
  const textColor = isDark ? '#e8eaed' : '#333'
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              label += context.parsed.y + (context.datasetIndex === 0 ? ' km/h' : ' mm');
            }
            return label;
          },
          afterBody: function(context) {
             const dataIndex = context[0].dataIndex
             const hourData = props.hourlyData[dataIndex]
             return [
               '',
               `🌡️ Température : ${hourData.temp}°C`,
               `💧 Proba. Pluie : ${hourData.rain}%`,
               `💨 Rafales : ${hourData.gust} km/h`
             ]
          }
        }
      }
    },
    layout: {
      padding: {
        left: -5,
        right: -5
      }
    },
    scales: {
      x: {
        ticks: { color: textColor },
        grid: { color: gridColor, display: false }
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Pluie (mm)',
          color: textColor
        },
        min: 0,
        suggestedMax: Math.max(1, ...props.hourlyData.map(d => d.precip)) * 1.2,
        ticks: { color: textColor },
        grid: { color: gridColor }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Vent (km/h)',
          color: textColor
        },
        min: 0,
        suggestedMax: Math.max(15, ...props.hourlyData.map(d => d.wind)) * 1.2,
        ticks: { color: textColor },
        grid: { drawOnChartArea: false },
      }
    }
  }
})
</script>

<template>
  <div class="weather-chart-container" :class="{ 'theme-dark': theme === 'dark' }">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.weather-chart-container {
  height: 250px;
  width: calc(100% + 3.75rem - 12px);
  margin-top: 15px;
  padding-top: 10px;
  border-top: 1px solid rgba(0,0,0,0.1);
}
.weather-chart-container.theme-dark {
  border-top-color: rgba(255,255,255,0.1);
}
</style>

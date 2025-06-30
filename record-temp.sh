#!/bin/bash
API_URL="http://192.168.1.8:3004/api/temperature"
timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

for device in /sys/bus/w1/devices/28*; do
    [ -d "$device" ] || continue
    device_id=$(basename "$device")
    sensor_data=$(cat "$device/w1_slave" 2>/dev/null)

    if echo "$sensor_data" | grep -q "YES"; then
        temp_raw=$(echo "$sensor_data" | grep "t=" | cut -d"=" -f2)
        if [ -n "$temp_raw" ]; then
            temp_f_calc=$((temp_raw * 9 / 5000 + 32))
            temp_f_remainder=$(((temp_raw * 9 % 5000) * 100 / 5000))
            temp_fahrenheit=$(printf "%d.%02d" $temp_f_calc $temp_f_remainder)

            echo "$(date '+%H:%M:%S') - $device_id - ${temp_fahrenheit}°F"
            curl -X POST "$API_URL" -H "Content-Type: application/json" -H "X-API-Key: $POOLMON_API_KEY" -d "{\"deviceId\":\"$device_id\",\"temperature\":$temp_fahrenheit,\"timestamp\":\"$timestamp\"}"
        fi
    fi
done

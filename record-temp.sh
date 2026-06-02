#!/bin/bash
API_URL="http://192.168.1.8:3004/api/temperature"
timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Known real sensors. The 1-wire bus occasionally enumerates phantom/corrupted
# device folders (junk IDs like 28-0a0014745c8c) that produce garbage readings.
# We only read from these known IDs and skip anything else.
KNOWN_SENSORS="28-012054745c8c 28-012054899557" # pool, outside

is_known_sensor() {
    for known in $KNOWN_SENSORS; do
        [ "$1" = "$known" ] && return 0
    done
    return 1
}

sensor_count=0
for device in /sys/bus/w1/devices/28*; do
    [ -d "$device" ] || continue
    is_known_sensor "$(basename "$device")" || continue
    sensor_count=$((sensor_count + 1))
done
echo "$(date '+%H:%M:%S') - found $sensor_count sensor(s)"

for device in /sys/bus/w1/devices/28*; do
    [ -d "$device" ] || continue
    device_id=$(basename "$device")

    # Skip phantom/unknown bus devices; only record the known sensors.
    if ! is_known_sensor "$device_id"; then
        echo "$(date '+%H:%M:%S') - $device_id - unknown sensor, skipping"
        continue
    fi

    temp_raw=""
    for attempt in $(seq 1 10); do
        sensor_data=$(cat "$device/w1_slave" 2>/dev/null)
        if ! echo "$sensor_data" | grep -q "YES"; then
            echo "$(date '+%H:%M:%S') - $device_id - CRC fail, retry $attempt/10"
            sleep 0.2
            continue
        fi
        candidate=$(echo "$sensor_data" | grep "t=" | cut -d"=" -f2)
        if [ -z "$candidate" ]; then
            echo "$(date '+%H:%M:%S') - $device_id - no temp value, retry $attempt/10"
            sleep 0.2
            continue
        fi

        # 85000 = power-on reset value; 0 = disconnected/shorted sensor
        if [ "$candidate" = "85000" ] || [ "$candidate" = "0" ]; then
            echo "$(date '+%H:%M:%S') - $device_id - bad reading ($candidate), retry $attempt/10"
            sleep 0.2
            continue
        fi

        echo "$(date '+%H:%M:%S') - $device_id - good reading ($candidate) on attempt $attempt/10"
        temp_raw=$candidate
        break
    done

    if [ -z "$temp_raw" ]; then
        echo "$(date '+%H:%M:%S') - $device_id - skipped after 10 failed attempts"
        continue
    fi

    temp_f_calc=$((temp_raw * 9 / 5000 + 32))
    temp_f_remainder=$(((temp_raw * 9 % 5000) * 100 / 5000))
    temp_fahrenheit=$(printf "%d.%02d" $temp_f_calc $temp_f_remainder)

    echo "$(date '+%H:%M:%S') - $device_id - ${temp_fahrenheit}°F"
    curl -X POST "$API_URL" -H "Content-Type: application/json" -H "X-API-Key: $POOLMON_API_KEY" -d "{\"deviceId\":\"$device_id\",\"temperature\":$temp_fahrenheit,\"timestamp\":\"$timestamp\"}"
done

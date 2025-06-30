#!/bin/bash

echo "Testing the new sensor-based API..."

# Test 1: Get current sensor mappings
echo "1. Getting current sensor mappings:"
curl -s "http://localhost:3000/api/sensors/mappings" | jq .

echo -e "\n2. Adding a new sensor mapping:"
curl -s -X POST "http://localhost:3000/api/sensors/mappings" \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "28-000123456789", "location": "pool", "name": "Pool Water Temperature"}' | jq .

echo -e "\n3. Adding another sensor mapping:"
curl -s -X POST "http://localhost:3000/api/sensors/mappings" \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "28-000987654321", "location": "outside", "name": "Outdoor Air Temperature"}' | jq .

echo -e "\n4. Getting updated sensor mappings:"
curl -s "http://localhost:3000/api/sensors/mappings" | jq .

echo -e "\n5. Posting temperature reading from pool sensor:"
curl -s -X POST "http://localhost:3000/api/sensors/reading" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 79.5, "deviceId": "28-000123456789"}' | jq .

echo -e "\n6. Posting temperature reading from outside sensor:"
curl -s -X POST "http://localhost:3000/api/sensors/reading" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 68.2, "deviceId": "28-000987654321"}' | jq .

echo -e "\n7. Posting from unknown sensor (should create default mapping):"
curl -s -X POST "http://localhost:3000/api/sensors/reading" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 72.1, "deviceId": "28-000111222333"}' | jq .

echo -e "\n8. Getting latest temperature readings:"
curl -s "http://localhost:3000/api/temperatures/latest?location=pool" | jq .
curl -s "http://localhost:3000/api/temperatures/latest?location=outside" | jq .

echo -e "\nDone! API tests completed."

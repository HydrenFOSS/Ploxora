# **Ploxora API Documentation (v1)**

**Module Author:** ma4z
**Version:** 1.0

**Base URL:** `/api/v1`

**Authentication:** All endpoints require an API key via query parameter `x-api-key`.

**Response Format:** JSON

```json
{
  "success": boolean,
  "data": object | array,
  "error": string (if applicable)
}
```

---

## **List Endpoints**

### `GET /list/nodes`

* **Description:** List all nodes in the system.
* **Response:**

```json
{
  "success": true,
  "nodes": [
    {
      "id": "nodeId",
      "name": "Node Name",
      "address": "IP Address",
      "port": 8080,
      "ram": 16,
      "cores": 4,
      "protocol": "http",
      "portEnabled": true,
      "allocations": [],
      "status": "Offline",
      "location": "US",
      "createdAt": "timestamp"
    }
  ]
}
```

### `GET /list/servers`

* **Description:** List all servers.
* **Response:** Similar to nodes, includes server details.

### `GET /list/users`

* **Description:** List all users.
* **Response:**

```json
{
  "success": true,
  "users": [
    {
      "id": "userId",
      "username": "name",
      "email": "email",
      "banned": false,
      "admin": true,
      "servers": []
    }
  ]
}
```

### `GET /list/nestbits`

* **Description:** List all NestBits.
* **Response:** Array of NestBit objects.

---

## **Nodes**

### `POST /nodes/new`

* **Description:** Create a new node.
* **Body Parameters:**

```json
{
  "name": "Node Name",
  "address": "IP Address",
  "port": 8080,
  "ram": 16,
  "cores": 4,
  "protocol": "http",
  "portEnabled": true
}
```

* **Response:** Newly created node object.

### `POST /nodes/delete`

* **Description:** Delete a node.
* **Body Parameters:**

```json
{ "nodeId": "id_of_node" }
```

* **Response:** `{ "success": true }`
* **Notes:** Cannot delete node if servers are linked.

### `POST /nodes/:id/allocations/add`

* **Description:** Add allocations (ports/IPs) to a node.
* **Body Parameters:**

```json
{
  "portRange": "3000-3010",
  "domain": "example.com",
  "ip": "127.0.0.1"
}
```

* **Response:** Updated allocations array.

---

## **Servers**

### `POST /servers/deploy`

* **Description:** Deploy a new server to a node.
* **Body Parameters:**

```json
{
  "name": "Server Name",
  "gb": 4,
  "cores": 2,
  "userId": "userId",
  "nodeId": "nodeId",
  "allocationId": 3000,
  "nestbitId": "nestbitId"
}
```

* **Response:** Deployed server object, including SSH connection.

### `POST /servers/delete`

* **Description:** Delete a server.
* **Body Parameters:**

```json
{ "serverId": "serverId" }
```

* **Response:** `{ "success": true }`

---

## **Users**

### `POST /users/new`

* **Description:** Create a new user.
* **Body Parameters:**

```json
{
  "username": "JohnDoe",
  "email": "john@example.com",
  "password": "password123",
  "admin": true
}
```

* **Response:** User object (without password).

### `POST /users/ban`

* **Description:** Ban a user.
* **Body Parameters:**

```json
{ "userId": "userId" }
```

* **Response:** Updated user object.

### `POST /users/unban`

* **Description:** Unban a user.
* **Body Parameters:**

```json
{ "userId": "userId" }
```

* **Response:** Updated user object.

### `POST /users/delete`

* **Description:** Delete a user.
* **Body Parameters:**

```json
{ "userId": "userId" }
```

* **Response:** `{ "success": true }`

---

## **Audit Logging**

* All critical actions are logged using `AuditLogger`.
* Actions include: CREATE\_NODE, DELETE\_NODE, ADD\_ALLOCATIONS, DEPLOY\_SERVER, DELETE\_SERVER, CREATE\_USER, BAN\_USER, UNBAN\_USER, DELETE\_USER.

---

## **Notes**

* All endpoints expect `application/json` body where applicable.
* Ports can be single numbers or ranges (e.g., `"3000-3010"`).
* `allocation.isBeingUsed` ensures no overlapping server deployment on the same port.
* API key required on all routes via query: `?x-api-key=YOUR_API_KEY`.

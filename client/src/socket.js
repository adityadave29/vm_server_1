import { io } from 'socket.io-client'

const socket = io('http://10.1.241.232:9000')

export default socket